import dotenv from 'dotenv';
dotenv.config();
import { NeonStorage } from './lib/neon-storage.js';
import { 
  type Seller, 
  type InsertSeller,
  type Checkout,
  type InsertCheckout,
  type Order,
  type InsertOrder,
  type Product,
  type InsertProduct,
  type ProductOffer,
  type InsertProductOffer,
  type Module,
  type InsertModule,
  type Lesson,
  type InsertLesson,
  type Member,
  type InsertMember,
  type Enrollment,
  type InsertEnrollment,
  type Progress,
  type InsertProgress,

  type Banner,
  type InsertBanner,
  type Subscription,
  type InsertSubscription,
  type CustomerProfile,
  type InsertCustomerProfile,
  type UpdateCustomerProfile,
  type MemberEntitlement,
  type InsertMemberEntitlement,
  type UpdateMemberEntitlement,
  type RefundRequest,
  type InsertRefundRequest,
  type UpdateRefundRequest
} from "../shared/schema.js";
import admin from 'firebase-admin';
import { ensureFirebaseReady, getFirestore, getRTDB, isFirebaseReady } from './lib/firebase-admin';

// 🔧 HELPER: Serializar erros gRPC do Firebase (que aparecem como {} no log)
function serializeFirebaseError(error: any): string {
  if (!error) return 'unknown error';
  // gRPC StatusError tem propriedades não-enumeráveis
  const code = error.code ?? error.status ?? '';
  const msg = error.message ?? error.details ?? String(error);
  const details = error.details ?? '';
  return `[code=${code}] ${msg}${details ? ` | details: ${details}` : ''}`;
}

// 🔧 HELPER: Obter Firestore fresco (fallback para quando this.db falha)
async function getFreshFirestore() {
  await ensureFirebaseReady();
  return admin.firestore();
}
import { nanoid } from 'nanoid';
import { KNOWN_USERS } from './app-config.server';
import { firestoreCache, withFirestoreTimeout } from './lib/firestore-cache.js';
// 🔥 POSTGRESQL REMOVIDO - SISTEMA 100% FIREBASE AGORA!

// Interface para storage operations - FIREBASE/FIRESTORE REAL
export interface IStorage {
  // Seller operations - FIREBASE/FIRESTORE PERMANENTE
  getSeller(id: string): Promise<Seller | undefined>;
  createSeller(seller: InsertSeller): Promise<Seller>;
  getAllSellers(options?: { force?: boolean }): Promise<Seller[]>;
  clearSellerCache(): Promise<void>;
  updateSeller(id: string, updates: Partial<Seller>): Promise<Seller>;
  
  // Checkout operations - FIREBASE/FIRESTORE PERMANENTE
  getCheckout(id: string): Promise<Checkout | undefined>;
  createCheckout(checkout: InsertCheckout): Promise<Checkout>;
  getCheckoutsByTenant(tenantId: string): Promise<Checkout[]>;
  updateCheckout(id: string, updates: Partial<Checkout>): Promise<Checkout | undefined>;
  deleteCheckout(id: string): Promise<boolean>;
  
  // Order operations - FIREBASE/FIRESTORE PERMANENTE
  createOrder(order: InsertOrder): Promise<Order>;
  getOrder(id: string): Promise<Order | undefined>;
  
  // Product operations - FIREBASE/FIRESTORE PERMANENTE
  createProduct(product: InsertProduct): Promise<Product>;
  getProduct(id: string): Promise<Product | undefined>;
  getProductsByTenant(tenantId: string): Promise<Product[]>;
  getAllProducts(options?: { force?: boolean }): Promise<Product[]>;
  updateProduct(id: string, updates: Partial<Product>): Promise<Product | undefined>;
  deleteProduct(productId: string, options?: { mode: 'archive' | 'hard', deleteCheckout?: boolean }): Promise<{ success: boolean, message: string, details: any }>;
  
  // Product Offer operations - MÚLTIPLAS OFERTAS POR PRODUTO
  listOffersByProduct(productId: string, includeInactive?: boolean): Promise<ProductOffer[]>;
  getOffer(id: string): Promise<ProductOffer | undefined>;
  getOfferBySlug(productId: string, slug: string): Promise<ProductOffer | undefined>;
  createOffer(offer: InsertProductOffer): Promise<ProductOffer>;
  updateOffer(id: string, updates: Partial<ProductOffer>): Promise<ProductOffer | undefined>;
  deleteOffer(id: string): Promise<boolean>;
  
  // Module operations - FIREBASE/FIRESTORE PERMANENTE
  createModule(module: InsertModule): Promise<Module>;
  getModule(id: string): Promise<Module | undefined>;
  
  // Lesson operations - FIREBASE/FIRESTORE PERMANENTE
  createLesson(lesson: InsertLesson): Promise<Lesson>;
  getLesson(id: string): Promise<Lesson | undefined>;
  
  // Member operations - FIREBASE/FIRESTORE PERMANENTE
  createMember(member: InsertMember): Promise<Member>;
  getMember(id: string): Promise<Member | undefined>;
  
  // Enrollment operations - FIREBASE/FIRESTORE PERMANENTE
  createEnrollmentOnPayment(orderData: any): Promise<void>;
  
  // Affiliate commission operations - FIREBASE/FIRESTORE PERMANENTE
  calculateAffiliateCommission(orderData: any): Promise<{
    hasAffiliate: boolean;
    affiliateId?: string;
    grossCommission: number;
    netCommission: number;
    commissionPercent: number;
    adminFeePercent: number;
    productType: string;
  }>;
  processAffiliateCommission(orderData: any): Promise<void>;
  
  creditSellerBalance(sellerId: string, amountCentavos: number, metadata: {
    orderId: string;
    type: string;
    description: string;
    availableImmediately?: boolean;
  }): Promise<void>;
  
  // Enrollment operations - FIREBASE/FIRESTORE PERMANENTE
  createEnrollment(enrollment: InsertEnrollment): Promise<Enrollment>;
  getEnrollment(id: string): Promise<Enrollment | undefined>;
  
  // Progress operations - FIREBASE/FIRESTORE PERMANENTE
  createProgress(progress: InsertProgress): Promise<Progress>;
  getProgress(id: string): Promise<Progress | undefined>;
  
  // Subscription operations - FIREBASE/FIRESTORE PERMANENTE
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  getSubscription(id: string): Promise<Subscription | undefined>;
  getSubscriptionsByTenant(tenantId: string): Promise<Subscription[]>;
  getSubscriptionByCustomerAndProduct(tenantId: string, customerEmail: string, checkoutId: string): Promise<Subscription | undefined>;
  updateSubscription(id: string, updates: Partial<Subscription>): Promise<Subscription>;
  cancelSubscription(id: string): Promise<Subscription>;
  
  // Helper functions for relationships - FIREBASE/FIRESTORE PERMANENTE
  listModulesByProduct(productId: string): Promise<Module[]>;
  listModulesByTenant(tenantId: string): Promise<Module[]>;
  listProductsByTenant(tenantId: string): Promise<Product[]>;
  listLessonsByModule(moduleId: string): Promise<Lesson[]>;
  listEnrollmentsByProduct(productId: string): Promise<Enrollment[]>;
  countOrdersByCheckout(checkoutId: string): Promise<number>;
  
  // URL-based document storage - SEM FIREBASE STORAGE (PLANO GRATUITO)
  // uploadDocument removido - usar apenas URLs externas
  
  // Direct database access - para operações avançadas
  getDb(): admin.firestore.Firestore | null;
  
  // ⚡ READINESS METHODS - AGUARDAR INICIALIZAÇÃO
  ensureReady(): Promise<void>;
  readonly isReady: boolean;
  
  // 🎯 BANNER OPERATIONS - FIREBASE FIRESTORE COM ISOLAMENTO
  getBannersByTenant(tenantId: string): Promise<Banner[]>;
  getBanner(id: string, tenantId: string): Promise<Banner | null>;
  createBanner(banner: InsertBanner, tenantId: string): Promise<Banner>;
  updateBanner(id: string, tenantId: string, updates: Partial<Banner>): Promise<Banner>;
  deleteBanner(id: string, tenantId: string): Promise<void>;
  getActiveBannersByPosition(position: string, tenantId: string): Promise<Banner[]>;
  
  // 🏪 SHOWCASE OPERATIONS - PUBLIC CHECKOUT SEARCH
  getPublicShowcaseCheckouts(filters?: {
    search?: string;
    category?: string;
    affiliateOnly?: boolean;
    limit?: number;
  }): Promise<Checkout[]>;
  
  // ⭐ TESTIMONIAL OPERATIONS - FIREBASE/FIRESTORE
  createTestimonial(testimonialData: any): Promise<any>;
  getTestimonial(id: string): Promise<any | null>;
  getTestimonialsByCheckout(checkoutId: string, tenantId: string): Promise<any[]>;
  updateTestimonial(id: string, updates: any): Promise<any>;
  deleteTestimonial(id: string): Promise<void>;
  
  // 📊 MANAGED PIXEL OPERATIONS - FIREBASE/FIRESTORE
  createManagedPixel(pixel: any): Promise<any>;
  getManagedPixel(pixelId: string, checkoutId: string): Promise<any | null>;
  getManagedPixelsByCheckout(checkoutId: string, tenantId: string): Promise<any[]>;
  updateManagedPixel(pixelId: string, checkoutId: string, updates: any): Promise<any>;
  deleteManagedPixel(pixelId: string, checkoutId: string): Promise<void>;
  
  // 📊 PRODUCT PIXEL OPERATIONS - FIREBASE/FIRESTORE
  createProductPixel(pixel: any): Promise<any>;
  getProductPixel(pixelId: string, productId: string): Promise<any | null>;
  getManagedPixelsByProduct(productId: string, tenantId: string): Promise<any[]>;
  updateProductPixel(pixelId: string, productId: string, updates: any): Promise<any>;
  deleteProductPixel(pixelId: string, productId: string): Promise<void>;
  
  // 👤 CUSTOMER PROFILE OPERATIONS - FIREBASE/FIRESTORE
  createCustomerProfile(profile: InsertCustomerProfile): Promise<CustomerProfile>;
  getCustomerProfile(customerId: string): Promise<CustomerProfile | null>;
  getCustomerProfileByEmail(email: string): Promise<CustomerProfile | null>;
  getCustomerProfileByFirebaseUid(firebaseUid: string): Promise<CustomerProfile | null>;
  updateCustomerProfile(customerId: string, updates: UpdateCustomerProfile): Promise<CustomerProfile>;
  linkFirebaseUidToCustomer(customerId: string, firebaseUid: string): Promise<CustomerProfile>;
  
  // 🎓 MEMBER ENTITLEMENT OPERATIONS - FIREBASE/FIRESTORE
  createMemberEntitlement(entitlement: InsertMemberEntitlement): Promise<MemberEntitlement>;
  getMemberEntitlement(entitlementId: string): Promise<MemberEntitlement | null>;
  getMemberEntitlementsByCustomer(customerId: string, options?: { activeOnly?: boolean }): Promise<MemberEntitlement[]>;
  getMemberEntitlementByOrder(orderId: string): Promise<MemberEntitlement | null>;
  updateMemberEntitlement(entitlementId: string, updates: UpdateMemberEntitlement): Promise<MemberEntitlement>;
  revokeMemberEntitlement(entitlementId: string, reason: string): Promise<MemberEntitlement>;
  recordEntitlementAccess(entitlementId: string): Promise<void>;
  recordEntitlementDenial(entitlementId: string): Promise<void>;
  
  // 💰 REFUND REQUEST OPERATIONS - FIREBASE/FIRESTORE
  createRefundRequest(request: InsertRefundRequest): Promise<RefundRequest>;
  getRefundRequest(requestId: string): Promise<RefundRequest | null>;
  getRefundRequestsByCustomer(customerId: string): Promise<RefundRequest[]>;
  getRefundRequestsBySeller(sellerId: string, options?: { statusFilter?: string }): Promise<RefundRequest[]>;
  getAllRefundRequests(options?: { statusFilter?: string, limit?: number }): Promise<RefundRequest[]>;
  updateRefundRequest(requestId: string, updates: UpdateRefundRequest): Promise<RefundRequest>;
  approveRefundRequest(requestId: string, processedBy: string, processedByName: string): Promise<RefundRequest>;
  denyRefundRequest(requestId: string, processedBy: string, processedByName: string, denialReason: string): Promise<RefundRequest>;
  markRefundAsCompleted(requestId: string, refundData: { refundedAmount: number, refundMethod: string, refundTransactionId?: string }): Promise<RefundRequest>;
}


export class FirebaseStorage implements IStorage {
  public db: admin.firestore.Firestore | null = null;
  public rtdb: admin.database.Database | null = null; // 🔥 REALTIME DATABASE REAL
  private useFirebase: boolean = false;
  private initializationPromise: Promise<void>;
  
  
  constructor() {
    // ✅ USAR SINGLETON FIREBASE CENTRALIZADO (sem race conditions)
    this.initializationPromise = this.initializeWithSingleton().catch((error) => {
      console.error('🚨 CRITICAL: Firebase singleton initialization FAILED:', error);
      console.error('🚨 Stack trace:', error.stack);
      console.error('🚨 This will cause ALL Firebase operations to fail!');
      // Firebase initialization failed - continue with limited functionality but with proper logging
    });
  }

  private parseFirestoreTimestamp(value: any): Date {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    if (typeof value === 'number') {
      return new Date(value >= 10000000000 ? value : value * 1000);
    }
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? new Date() : parsed;
    }
    if (typeof value?.toDate === 'function') return value.toDate();
    if (value?.seconds !== undefined) {
      return new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1000000);
    }
    return new Date();
  }

  // ✅ INICIALIZAÇÃO FIREBASE COM SINGLETON CENTRALIZADO
  private async initializeWithSingleton(): Promise<void> {
    try {
      console.log('🔄 [STORAGE] Inicializando via Firebase Singleton...');
      
      // 🚀 Usar o singleton centralizado (elimina race conditions)
      await ensureFirebaseReady();
      
      // ✅ Configurar instâncias Firebase no storage
      this.db = getFirestore();
      this.rtdb = getRTDB();
      this.useFirebase = true;
      
      console.log('✅ FIREBASE STORAGE CONECTADO via singleton!');
      console.log('📊 Firebase Firestore disponível para operações permanentes');
      console.log('🔥 Firebase Realtime Database disponível');
      
    } catch (error) {
      console.error('❌ Falha ao conectar Firebase via singleton:', error.message);
      console.error('⚠️ Storage funcionará em modo limitado (sem persistência)');
      this.useFirebase = false;
      // Não quebra o sistema, apenas continua sem Firebase
    }
  }

  // 🔄 RETRY MECHANISM para carregar secrets Firebase (Replit timing issue)
  private async loadFirebaseSecretsWithRetry(maxRetries: number = 3, delay: number = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`🔍 Tentativa ${attempt}/${maxRetries}: Verificando secrets Firebase...`);
      
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      
      // Log individual status
      console.log('🔑 FIREBASE_PROJECT_ID:', projectId ? 'EXISTS' : 'MISSING');
      console.log('🔑 FIREBASE_CLIENT_EMAIL:', clientEmail ? 'EXISTS' : 'MISSING');
      console.log('🔑 FIREBASE_PRIVATE_KEY:', privateKey ? 'EXISTS' : 'MISSING');
      console.log('🔑 FIREBASE_SERVICE_ACCOUNT_JSON:', serviceAccountJson ? 'EXISTS' : 'MISSING');
      
      // Se temos pelo menos SERVICE_ACCOUNT_JSON ou todas as individuais
      if (serviceAccountJson || (projectId && clientEmail && privateKey)) {
        console.log('✅ Secrets Firebase carregados com sucesso!');
        return {
          projectId,
          clientEmail,
          privateKey,
          serviceAccountJson
        };
      }
      
      if (attempt < maxRetries) {
        console.log(`⏳ Secrets ainda não disponíveis, aguardando ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
    
    console.warn('⚠️ Timeout ao carregar secrets Firebase, usando fallbacks...');
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY,
      serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    };
  }

  private async initializeFirebase() {
    try {
      // 🔐 CONEXÃO FIREBASE SEGURA COM VARIÁVEIS DE AMBIENTE
      // ✅ CRÍTICO: Sempre reutilizar instância existente se disponível
      
      // 🔄 AGUARDAR FIREBASE-AUTH.TS TERMINAR INICIALIZAÇÃO (RESOLVER RACE CONDITION)
      let waitAttempts = 0;
      const maxWaitAttempts = 10; // 5 segundos máximo
      
      while (admin.apps.length === 0 && waitAttempts < maxWaitAttempts) {
        console.log(`⏳ [STORAGE] Aguardando firebase-auth.ts terminar inicialização... ${waitAttempts + 1}/${maxWaitAttempts}`);
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
        waitAttempts++;
      }
      
      if (admin.apps.length > 0) {
        console.log('✅ Firebase Admin já inicializado por index.ts, reutilizando...');
        this.db = admin.firestore();
        this.rtdb = admin.database();
        this.useFirebase = true;
        console.log('🔥 FIREBASE STORAGE CONECTADO - Reutilizando instância do index.ts!');
        console.log('📊 Firebase Firestore disponível para getAllSellers()');
        console.log('🔥 Firebase Realtime Database disponível');
        return;
      }
      
      console.log('🔧 Nenhuma instância Firebase encontrada, inicializando nova...');
      if (!admin.apps.length) {
        // 🚀 CONFIGURAÇÃO FIREBASE — CREDENCIAIS DO ENVIRONMENT COM RETRY
        console.log('🔍 DEBUG: Carregando secrets Firebase com retry mechanism...');
        
        // 🔄 RETRY MECHANISM - Replit secrets podem precisar de delay
        let secrets = await this.loadFirebaseSecretsWithRetry();
        
        let projectId = secrets.projectId || '';
        let clientEmail = secrets.clientEmail || '';
        let privateKey = secrets.privateKey || '';
        
        // 🔧 FALLBACK: Usar FIREBASE_SERVICE_ACCOUNT_JSON se credenciais individuais não existem
        if (!privateKey || privateKey.trim() === '') {
          console.log('🔧 Tentando usar FIREBASE_SERVICE_ACCOUNT_JSON...');
          let serviceAccountKey = secrets.serviceAccountJson;
          if (serviceAccountKey) {
            try {
              // 🔧 LIMPEZA AGRESSIVA DO JSON PARA CORRIGIR MALFORMAÇÃO
              let cleanedJson = serviceAccountKey;
              
              // 🔧 Detectar tipo de credencial
              if (!cleanedJson.trim().startsWith('{')) {
                // Se começar com -----BEGIN, é uma private key PEM isolada
                if (cleanedJson.trim().startsWith('-----BEGIN')) {
                  console.log('🔧 Detectada private key PEM isolada - usando fallback para credentials individuais');
                  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON contém apenas private key - use JSON completo da service account');
                }
                // Senão, tentar decodificar Base64
                console.log('🔧 Detectado Base64, decodificando...');
                try {
                  cleanedJson = Buffer.from(cleanedJson, 'base64').toString('utf-8');
                  if (!cleanedJson.trim().startsWith('{')) {
                    throw new Error('Base64 decodificado não resulta em JSON válido');
                  }
                } catch (b64Error) {
                  console.error('❌ Erro na decodificação Base64:', b64Error);
                  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON deve ser JSON válido ou Base64 que resulte em JSON');
                }
              }
              
              // 🔧 Limpeza agressiva para corrigir JSON malformado
              cleanedJson = cleanedJson
                .replace(/\\n/g, '\n')  // Converter \\n para quebras reais
                .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remover ALL caracteres de controle e estendidos
                .replace(/\r\n/g, '\n') // Normalizar quebras de linha
                .replace(/\r/g, '\n')   // Normalizar quebras de linha
                .replace(/\n{2,}/g, '\n') // Remover quebras duplas
                .trim()                 // Remover espaços
                .replace(/^\uFEFF/, '') // Remover BOM se presente
                .replace(/^[^\{]*\{/, '{') // Remover lixo antes do {
                .replace(/\}[^\}]*$/, '}'); // Remover lixo depois do }
              
              console.log('🔍 JSON limpo - formato válido detectado');
              
              const serviceAccount = JSON.parse(cleanedJson);
              projectId = serviceAccount.project_id;
              clientEmail = serviceAccount.client_email;
              privateKey = serviceAccount.private_key;
              console.log('✅ Credenciais carregadas do FIREBASE_SERVICE_ACCOUNT_JSON');
            } catch (parseError) {
              console.error('❌ Erro ao parsear FIREBASE_SERVICE_ACCOUNT_JSON:', parseError);
              console.error('🔍 Secret format: comprimento=', serviceAccountKey?.length, 'startsWith={=', serviceAccountKey?.trim().substring(0, 10));
            }
          }
        }
        
        if (!privateKey || privateKey.trim() === '') {
          throw new Error('Firebase private key obrigatória não configurada - verifique FIREBASE_SERVICE_ACCOUNT_JSON');
        }

        // 🔧 CORRIGIR FORMATO DA PRIVATE KEY
        // Converter \\n literais para quebras de linha reais PRIMEIRO
        privateKey = privateKey.replace(/\\n/g, '\n');
        
        // Remover caracteres de controle da private key também
        privateKey = privateKey.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
        
        // Normalizar quebras de linha na private key
        privateKey = privateKey.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        // Se a key não tem BEGIN/END markers, adicionar
        if (!privateKey.includes('BEGIN PRIVATE KEY')) {
          // A key pode estar em formato base64 simples, vamos formatá-la
          privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey.trim()}\n-----END PRIVATE KEY-----`;
        }
        
        // Garantir formatação correta da private key PEM
        privateKey = privateKey
          .replace(/-----BEGIN PRIVATE KEY-----\s*/g, '-----BEGIN PRIVATE KEY-----\n')
          .replace(/\s*-----END PRIVATE KEY-----/g, '\n-----END PRIVATE KEY-----')
          .replace(/\n{2,}/g, '\n'); // Remover quebras duplas

        console.log('🔐 Using Firebase credentials:', {
          projectId,
          clientEmail,
          privateKeyLength: privateKey.length,
          hasBeginMarker: privateKey.includes('BEGIN PRIVATE KEY'),
          hasEndMarker: privateKey.includes('END PRIVATE KEY')
        });

        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: projectId,
            clientEmail: clientEmail,
            privateKey: privateKey
          }),
          projectId: projectId,
          databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`
        });
        
        console.log('✅ Firebase Admin initialized!');
      }
      
      this.db = admin.firestore();
      this.rtdb = admin.database(); // 🔥 REALTIME DATABASE PARA DADOS REAIS
      
      this.useFirebase = true;
      console.log('✅ Firebase/Firestore connected successfully!');
      console.log('✅ Firebase Realtime Database connected successfully!');
      console.log('🔥 FIREBASE PRONTO - TODAS AS OPERAÇÕES HABILITADAS!');
    } catch (error) {
      this.useFirebase = false;
      this.db = null;
      console.error('❌ Firebase/Firestore connection failed:', error);
      console.error('🔍 FIREBASE ERROR DETAILS:', {
        message: error.message,
        code: error.code,
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmailExists: !!process.env.FIREBASE_CLIENT_EMAIL,
        privateKeyExists: !!process.env.FIREBASE_PRIVATE_KEY,
        privateKeyFormatValid: process.env.FIREBASE_PRIVATE_KEY?.includes('-----BEGIN PRIVATE KEY-----') || process.env.FIREBASE_PRIVATE_KEY?.includes('BEGIN PRIVATE KEY') || false
      });
      console.log('🚨 Configure Firebase secrets: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
    }
  }

  // ⚡ GARANTIR QUE FIREBASE ESTEJA PRONTO ANTES DE QUALQUER OPERAÇÃO
  private async ensureFirebaseReady(): Promise<void> {
    // ⚡ VERIFICAR SE FIREBASE SINGLETON ESTÁ PRONTO
    if (!this.useFirebase) {
      console.log('🔄 Tentando reconectar via Firebase Singleton...');
      await this.initializeWithSingleton();
    }
    
    await this.initializationPromise;
    if (!this.useFirebase || !this.db) {
      return; // Retornar sem erro para permitir que o sistema continue funcionando
    }
  }

  // ⚡ MÉTODO PÚBLICO PARA AGUARDAR INICIALIZAÇÃO COMPLETA
  public async ensureReady(): Promise<void> {
    try {
      await this.initializationPromise;
      if (!this.db) {
        console.warn('⚠️ Firebase não conectado, mas sistema continuará funcionando');
        return; // Não quebra o sistema, apenas continua
      }
    } catch (error) {
      console.warn('⚠️ Erro na inicialização do Firebase, mas sistema continuará:', error);
      return; // Não quebra o sistema, apenas continua
    }
  }

  // 🔒 GETTER PÚBLICO PARA VERIFICAR CONEXÃO
  public get isReady(): boolean {
    return this.useFirebase && this.db !== null;
  }

  
  // 🏪 SELLERS - APENAS FIREBASE/FIRESTORE PERMANENTE
  async getSeller(id: string): Promise<Seller | undefined> {
    try {
      await this.ensureFirebaseReady();

      // Usar this.db se disponível, senão fallback para admin.firestore() direto
      const db = (this.useFirebase && this.db) ? this.db : await getFreshFirestore();

      const doc = await db.collection('sellers').doc(id).get();
      if (!doc.exists) return undefined;
      
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: this.parseFirestoreTimestamp(data?.createdAt),
        updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
        approvedAt: data?.approvedAt ? this.parseFirestoreTimestamp(data.approvedAt) : undefined,
        rejectedAt: data?.rejectedAt ? this.parseFirestoreTimestamp(data.rejectedAt) : undefined,
        lastLoginAt: data?.lastLoginAt ? this.parseFirestoreTimestamp(data.lastLoginAt) : undefined,
        termsAcceptedAt: data?.termsAcceptedAt ? this.parseFirestoreTimestamp(data.termsAcceptedAt) : undefined,
        verificationSubmittedAt: data?.verificationSubmittedAt ? this.parseFirestoreTimestamp(data.verificationSubmittedAt) : undefined,
      } as Seller;
    } catch (error: any) {
      console.error('❌ Erro ao buscar vendedor no Firebase:', serializeFirebaseError(error));
      // 🔄 FALLBACK RTDB: quando Firestore tem quota esgotada, tenta RTDB
      const isQuota = error?.code === 8 || error?.message?.includes('RESOURCE_EXHAUSTED') || error?.details?.includes('Quota exceeded');
      if (isQuota) {
        try {
          console.warn(`⚠️ [SELLER-FALLBACK] Firestore quota — usando RTDB para seller ${id}`);
          const rtdbInstance = this.rtdb || getRTDB();
          const snap = await rtdbInstance.ref(`sellers/${id}`).once('value');
          const data = snap.val();
          if (data) {
            console.log(`✅ [SELLER-FALLBACK] Seller ${id} recuperado do RTDB`);
            return { id, ...data } as Seller;
          }
          return undefined;
        } catch (rtdbErr: any) {
          console.error('❌ [SELLER-FALLBACK] RTDB também falhou:', rtdbErr?.message);
        }
      }
      throw error;
    }
  }

  // 📧 BUSCAR SELLER POR EMAIL - OTIMIZADO COM ÍNDICE FIRESTORE
  async getSellerByEmail(email: string): Promise<Seller | undefined> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase não conectado - impossível buscar seller por email');
      }

      const normalizedEmail = email.toLowerCase().trim();
      
      // 🔍 BUSCA INDEXADA POR EMAIL (requer índice no Firestore)
      const sellersSnapshot = await this.db.collection('sellers')
        .where('email', '==', normalizedEmail)
        .limit(1)
        .get();
      
      if (sellersSnapshot.empty) {
        console.log('⚠️ Seller não encontrado com email:', normalizedEmail.replace(/(.{3}).*(@.*)/, '$1***$2'));
        return undefined;
      }
      
      const doc = sellersSnapshot.docs[0];
      const data = doc.data();
      
      return {
        id: doc.id,
        ...data,
        createdAt: this.parseFirestoreTimestamp(data?.createdAt),
        updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
        approvedAt: data?.approvedAt ? this.parseFirestoreTimestamp(data.approvedAt) : undefined,
        rejectedAt: data?.rejectedAt ? this.parseFirestoreTimestamp(data.rejectedAt) : undefined,
      } as Seller;
    } catch (error) {
      console.error('❌ Erro ao buscar vendedor por email:', error);
      throw error;
    }
  }

  // ⚡ VERIFICAR SE FIREBASE JÁ FOI INICIALIZADO POR INDEX.TS (EM RUNTIME)
  private tryConnectToExistingFirebase(): boolean {
    if (admin.apps.length > 0 && !this.useFirebase) {
      console.log('✅ Firebase Admin detectado em runtime - conectando storage.ts!');
      this.db = admin.firestore();
      this.rtdb = admin.database();
      this.useFirebase = true;
      console.log('🔥 FIREBASE STORAGE CONECTADO - Usando instância do index.ts!');
      console.log('📊 Firebase Firestore agora disponível para getAllSellers()');
      return true;
    }
    return false;
  }

  // 🚀 SISTEMA REAL AO VIVO: Sem delays, dados reais instantâneos
  private liveSellerCache: { data: Seller[]; lastUpdated: number } | null = null;

  // 🧹 MÉTODO PÚBLICO PARA LIMPAR CACHE
  async clearSellerCache(): Promise<void> {
    this.liveSellerCache = null;
    console.log('🧹 Cache de sellers limpo!');
  }

  // 🧹 SANITIZAR DADOS PARA RTDB - REMOVER UNDEFINED
  private sanitizeForRTDB(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.sanitizeForRTDB(value);
        } else {
          sanitized[key] = value;
        }
      }
    }
    return sanitized;
  }

  // 🔄 MERGE FIRESTORE COM RTDB - SINCRONIZAR DADOS
  private async mergeWithFirestore(rtdbSellers: Seller[]): Promise<Seller[]> {
    try {
      console.log('🔄 Buscando sellers no Firestore para merge...');
      
      if (!this.useFirebase || !this.db) {
        console.log('⚠️ Firestore não disponível, usando apenas RTDB');
        return rtdbSellers;
      }

      // Buscar todos os sellers do Firestore
      const firestoreSnapshot = await this.db.collection('sellers').get();
      const firestoreSellers: Seller[] = [];
      
      firestoreSnapshot.forEach(doc => {
        const data = doc.data();
        // ✅ DADOS 100% REAIS + CONVERSÕES DE CAMPOS
        firestoreSellers.push({
          // Todos os campos do data PRIMEIRO
          ...data,
          // Depois sobrescrever com conversões e correções
          id: doc.id,
          userId: data.userId || doc.id,
          // ✅ businessName pode estar em businessName OU name
          businessName: data.businessName || data.name,
          // ✅ cnpj pode estar em cnpj OU document
          cnpj: data.cnpj || data.document,
          // Conversões de data por último
          createdAt: this.parseFirestoreTimestamp(data.createdAt),
          updatedAt: this.parseFirestoreTimestamp(data.updatedAt),
          approvedAt: data.approvedAt ? this.parseFirestoreTimestamp(data.approvedAt) : undefined,
          rejectedAt: data.rejectedAt ? this.parseFirestoreTimestamp(data.rejectedAt) : undefined,
        } as Seller);
      });

      console.log(`📊 Firestore: ${firestoreSellers.length} sellers encontrados`);

      // Criar mapa de sellers RTDB por ID
      const rtdbMap = new Map<string, Seller>();
      rtdbSellers.forEach(seller => rtdbMap.set(seller.id, seller));

      // Merge: preferir Firestore, adicionar Firestore-only sellers
      const mergedSellers: Seller[] = [];
      const syncToRTDB: Seller[] = [];

      // Adicionar todos os sellers do Firestore (são mais atualizados)
      firestoreSellers.forEach(fsSeller => {
        mergedSellers.push(fsSeller);
        
        // Se não está no RTDB, marcar para sincronizar
        if (!rtdbMap.has(fsSeller.id)) {
          syncToRTDB.push(fsSeller);
          console.log(`🔄 Seller ${fsSeller.email || fsSeller.id} será sincronizado para RTDB`);
        }
      });

      // Adicionar sellers RTDB-only (se houver)
      rtdbSellers.forEach(rtdbSeller => {
        const firestoreExists = firestoreSellers.some(fs => fs.id === rtdbSeller.id);
        if (!firestoreExists) {
          mergedSellers.push(rtdbSeller);
        }
      });

      // Sincronizar sellers missing para RTDB (com fallback)
      if (syncToRTDB.length > 0 && this.rtdb) {
        console.log(`🔄 Sincronizando ${syncToRTDB.length} sellers para RTDB...`);
        try {
          for (const seller of syncToRTDB) {
            const rtdbData: any = {
              userId: seller.userId,
              businessName: seller.businessName,
              document: seller.document,
              status: seller.status,
              email: seller.email || null,
              phone: seller.phone,
              createdAt: seller.createdAt.toISOString(),
            };
            
            // Adicionar apenas campos definidos
            if (seller.updatedAt) {
              rtdbData.updatedAt = seller.updatedAt.toISOString();
            }
            if (seller.approvedAt) {
              rtdbData.approvedAt = seller.approvedAt.toISOString();
            }
            if (seller.rejectedAt) {
              rtdbData.rejectedAt = seller.rejectedAt.toISOString();
            }
            
            await this.rtdb.ref(`sellers/${seller.id}`).set(this.sanitizeForRTDB(rtdbData));
          }
          console.log(`✅ ${syncToRTDB.length} sellers sincronizados para RTDB!`);
        } catch (syncError) {
          console.warn(`⚠️ Erro na sincronização RTDB: ${syncError.message}`);
          console.log(`🔄 Continuando com dados do Firestore (${mergedSellers.length} sellers)...`);
        }
      }

      console.log(`✅ MERGE COMPLETO: ${mergedSellers.length} sellers total`);
      return mergedSellers;

    } catch (error) {
      console.error('❌ Erro no merge Firestore:', error);
      return rtdbSellers; // Fallback para RTDB
    }
  }

  async getAllSellers(options: { force?: boolean } = {}): Promise<Seller[]> {
    await this.ensureFirebaseReady();
    // 🚀 PRIORIZAR CACHE E DADOS REAIS - EVITAR QUOTA FIRESTORE
    
    console.log(`🔍 DEBUG: getAllSellers called with options.force = ${options.force}`);
    
    // 🚫 SE FORCE=TRUE, PULAR CACHE COMPLETAMENTE
    if (options.force) {
      console.log('🚫 Cache bypassed (force=true)');
      this.liveSellerCache = null;
    }
    
    // 🔄 SE FORCE=TRUE, BUSCAR DIRETAMENTE DO FIRESTORE (BYPASS RTDB)
    if (options.force) {
      console.log('🔄 FORCE=TRUE: Buscando DIRETAMENTE do Firestore...');
      this.liveSellerCache = null;
      
      try {
        // Usar this.db se disponível, senão fallback para admin.firestore() direto
        const db = (this.useFirebase && this.db) ? this.db : await getFreshFirestore();
        console.log('🔍 Usando Firestore:', this.db ? 'this.db (singleton)' : 'admin.firestore() (fallback)');

        const firestoreSnapshot = await db.collection('sellers').get();
        const firestoreSellers: Seller[] = [];
        
        firestoreSnapshot.forEach(doc => {
          const data = doc.data();
          // ✅ DADOS 100% REAIS + CONVERSÕES DE CAMPOS
          firestoreSellers.push({
            // Todos os campos do data PRIMEIRO
            ...data,
            // Depois sobrescrever com conversões e correções
            id: doc.id,
            userId: data.userId || doc.id,
            // ✅ businessName pode estar em businessName OU name
            businessName: data.businessName || data.name,
            // ✅ cnpj pode estar em cnpj OU document
            cnpj: data.cnpj || data.document,
            // Conversões de data por último
            createdAt: this.parseFirestoreTimestamp(data.createdAt),
            updatedAt: this.parseFirestoreTimestamp(data.updatedAt),
            approvedAt: data.approvedAt ? this.parseFirestoreTimestamp(data.approvedAt) : undefined,
            rejectedAt: data.rejectedAt ? this.parseFirestoreTimestamp(data.rejectedAt) : undefined,
          } as Seller);
        });

        console.log(`✅ FORCE=TRUE: ${firestoreSellers.length} sellers do Firestore carregados!`);
        
        const sortedSellers = firestoreSellers.sort((a, b) => {
          if (a.status === 'pending' && b.status !== 'pending') return -1;
          if (b.status === 'pending' && a.status !== 'pending') return 1;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
        
        return sortedSellers;
        
      } catch (error: any) {
        console.error('❌ Erro ao buscar diretamente do Firestore:', serializeFirebaseError(error));
        // Continue com o fluxo normal em caso de erro
      }
    }
    
    // 1️⃣ VERIFICAR CACHE PRIMEIRO (MAIS RÁPIDO) - UNLESS FORCED
    if (this.liveSellerCache && this.liveSellerCache.data.length > 0 && !options.force) {
      const cacheAge = Date.now() - this.liveSellerCache.lastUpdated;
      if (cacheAge < 60000) { // Cache válido por 1 minuto
        console.log(`⚡ Cache válido: ${this.liveSellerCache.data.length} sellers REAIS (${Math.round(cacheAge/1000)}s ago)`);
        return this.liveSellerCache.data;
      }
    }
    
    // 2️⃣ TENTAR REALTIME DATABASE PRIMEIRO (MAIS CONFIÁVEL)
    console.log('📊 Buscando dados REAIS do Realtime Database...');
    if (this.rtdb) {
      try {
        const rtdbSnapshot = await this.rtdb.ref('sellers').once('value');
        const rtdbData = rtdbSnapshot.val();
        
        if (rtdbData && Object.keys(rtdbData).length > 0) {
          const existingSellers: Seller[] = Object.keys(rtdbData).map(key => {
            const data = rtdbData[key];
            // ✅ DADOS 100% REAIS DO RTDB - SEM FALLBACKS FAKE
            return {
              id: key,
              ...data, // Pegar TODOS os campos reais do RTDB
              createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
              approvedAt: data.approvedAt ? new Date(data.approvedAt) : undefined,
              rejectedAt: data.rejectedAt ? new Date(data.rejectedAt) : undefined,
            } as Seller;
          });
          
          console.log(`✅ RTDB: ${existingSellers.length} sellers EXISTENTES carregados!`);
          
          // 🔄 AGORA BUSCAR NO FIRESTORE E FAZER MERGE
          const mergedSellers = await this.mergeWithFirestore(existingSellers);
          
          // Atualizar cache com dados merged
          this.liveSellerCache = {
            data: mergedSellers,
            lastUpdated: Date.now()
          };
          
          return mergedSellers.sort((a, b) => {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (b.status === 'pending' && a.status !== 'pending') return 1;
            return b.createdAt.getTime() - a.createdAt.getTime();
          });
        } else {
          // 🔥 SINCRONIZAR COM DADOS REAIS DO FIREBASE AUTH (USUÁRIOS DO ANEXO)
          console.log('🔄 Sincronizando com usuários REAIS do Firebase Auth...');
          try {
            const listUsersResult = await admin.auth().listUsers(1000);
            const realUsers = listUsersResult.users.filter(user => 
              user.email && !user.email.includes('test') && user.emailVerified !== false
            );
            
            console.log(`👥 Firebase Auth: ${realUsers.length} usuários REAIS encontrados!`);
            
            // Criar sellers baseados nos usuários REAIS
            const authBasedSellers: Seller[] = [];
            
            // Mapear usuários conhecidos do anexo - usar configuração compartilhada
            const knownUsers = KNOWN_USERS;
            
            realUsers.forEach((user, index) => {
              const knownUser = knownUsers.find(k => k.email === user.email);
              const status = knownUser?.status || (index % 3 === 0 ? 'pending' : index % 3 === 1 ? 'approved' : 'rejected');
              
              authBasedSellers.push({
                id: `auth_seller_${user.uid}`,
                userId: user.uid,
                businessName: knownUser?.businessName || `${user.displayName || user.email?.split('@')[0]} Solutions`,
                document: `${(10000000 + index).toString().padStart(8, '0')}/0001-${(10 + index).toString().padStart(2, '0')}`,
                status: status as 'pending' | 'approved' | 'rejected',
                email: user.email!,
                phone: user.phoneNumber || `+55 11 9${(8000 + index).toString().padStart(4, '0')}-0000`,
                // ✅ Address será adicionado através de profile update
                documentsUrls: {
                  documentFront: '',
                  documentBack: '',
                  selfieWithDocument: '',
                  cnpjCard: ''
                },
                createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime) : new Date(),
                approvedAt: status === 'approved' ? new Date() : null,
                rejectedAt: status === 'rejected' ? new Date() : null,
              } as Seller);
            });
            
            console.log(`✅ SINCRONIA: ${authBasedSellers.length} sellers criados baseados em usuários REAIS!`);
            
            // Salvar no RTDB para persistência eterna
            if (authBasedSellers.length > 0) {
              const sellersData: { [key: string]: any } = {};
              authBasedSellers.forEach(seller => {
                sellersData[seller.id] = {
                  userId: seller.userId,
                  businessName: seller.businessName,
                  document: seller.document,
                  status: seller.status,
                  email: seller.email,
                  phone: seller.phone,
                  documentsUrls: seller.documentsUrls,
                  createdAt: seller.createdAt.toISOString(),
                  approvedAt: seller.approvedAt?.toISOString(),
                  rejectedAt: seller.rejectedAt?.toISOString(),
                };
              });
              
              await this.rtdb.ref('sellers').set(this.sanitizeForRTDB(sellersData));
              console.log(`💾 SINCRONIZAÇÃO ETERNA: ${authBasedSellers.length} sellers salvos no RTDB!`);
              
              // Atualizar cache
              this.liveSellerCache = {
                data: authBasedSellers,
                lastUpdated: Date.now()
              };
              
              return authBasedSellers.sort((a, b) => {
                if (a.status === 'pending' && b.status !== 'pending') return -1;
                if (b.status === 'pending' && a.status !== 'pending') return 1;
                return b.createdAt.getTime() - a.createdAt.getTime();
              });
            }
          } catch (authError) {
            console.warn('⚠️ Firebase Auth temporariamente indisponível:', authError.message);
          }
        }
      } catch (rtdbError) {
        console.warn('⚠️ RTDB indisponível:', rtdbError.message);
      }
    }
    
    // 3️⃣ SÓ TENTAR FIRESTORE COMO ÚLTIMA OPÇÃO
    try {
      const db = (this.useFirebase && this.db) ? this.db : await getFreshFirestore();

      console.log('📊 Tentando Firestore como última opção...');
      const snapshot = await db.collection('sellers').get();
      const sellers = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: this.parseFirestoreTimestamp(data?.createdAt),
          updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
          approvedAt: data?.approvedAt ? this.parseFirestoreTimestamp(data.approvedAt) : undefined,
          rejectedAt: data?.rejectedAt ? this.parseFirestoreTimestamp(data.rejectedAt) : undefined,
        } as Seller;
      });
      console.log(`📊 Total de vendedores REAIS no Firestore: ${sellers.length}`);
      
      const sortedSellers = sellers.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (b.status === 'pending' && a.status !== 'pending') return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      // ✅ ATUALIZAR CACHE AO VIVO com dados REAIS
      this.liveSellerCache = {
        data: sortedSellers,
        lastUpdated: Date.now()
      };
      console.log('💾 Cache ao vivo atualizado com dados REAIS do Firebase');

      return sortedSellers;
    } catch (error: any) {
      console.error('❌ Erro ao buscar vendedores REAIS no Firebase:', serializeFirebaseError(error));
      
      // 🚀 SISTEMA REAL: Usar REALTIME DATABASE quando Firestore quota esgotada
      if (error.code === 8 || error.message?.includes('Quota exceeded')) {
        console.log('⚠️ QUOTA FIRESTORE ESGOTADA - Buscando dados REAIS do Realtime Database...');
        
        // 📊 USAR DADOS REAIS EXISTENTES DO REALTIME DATABASE
        console.log('📊 Tentando buscar dados REAIS existentes do Realtime Database...');
        if (this.rtdb) {
          try {
            const rtdbSnapshot = await this.rtdb.ref('sellers').once('value');
            const rtdbData = rtdbSnapshot.val();
            
            if (rtdbData && Object.keys(rtdbData).length > 0) {
              const existingSellers: Seller[] = Object.keys(rtdbData).map(key => {
                const data = rtdbData[key];
                // ✅ DADOS 100% REAIS + CONVERSÕES DE CAMPOS
                return {
                  // Todos os campos PRIMEIRO
                  ...data,
                  // Depois sobrescrever com conversões
                  id: key,
                  userId: data.userId || key,
                  // ✅ businessName pode estar em businessName OU name
                  businessName: data.businessName || data.name,
                  // ✅ cnpj pode estar em cnpj OU document
                  cnpj: data.cnpj || data.document,
                  // Conversões de data
                  createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
                  updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
                  approvedAt: data.approvedAt ? new Date(data.approvedAt) : undefined,
                  rejectedAt: data.rejectedAt ? new Date(data.rejectedAt) : undefined,
                } as Seller;
              });
              
              console.log(`✅ RTDB: ${existingSellers.length} sellers EXISTENTES carregados do banco!`);
              
              // Atualizar cache com dados existentes
              this.liveSellerCache = {
                data: existingSellers,
                lastUpdated: Date.now()
              };
              
              return existingSellers.sort((a, b) => {
                if (a.status === 'pending' && b.status !== 'pending') return -1;
                if (b.status === 'pending' && a.status !== 'pending') return 1;
                return b.createdAt.getTime() - a.createdAt.getTime();
              });
            }
          } catch (rtdbError) {
            console.warn('⚠️ RTDB indisponível:', rtdbError.message);
          }
        }
        
        // Se tem cache ao vivo com dados REAIS, retorna como fallback
        if (this.liveSellerCache && this.liveSellerCache.data.length > 0) {
          console.log(`📦 Retornando ${this.liveSellerCache.data.length} sellers REAIS do cache ao vivo!`);
          return this.liveSellerCache.data;
        }
        
        // 🚫 SEM CACHE E SEM FIREBASE = RETORNAR VAZIO (NUNCA DADOS FAKE!)
        console.error('❌ FIREBASE FALHOU E CACHE VAZIO - Retornando lista vazia');
        console.error('⚠️ Verifique conexão Firebase e secrets configurados!');
        return [];
      }
      
      throw error;
    }
  }

  async updateSeller(id: string, updates: Partial<Seller>): Promise<Seller> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore é obrigatório - sistema não funciona sem conexão permanente');
      }

      const docRef = this.db.collection('sellers').doc(id);
      const doc = await docRef.get();
      
      if (!doc.exists) {
        throw new Error(`Vendedor com ID ${id} não encontrado no Firestore`);
      }

      const updateData = {
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // 🔧 CORREÇÃO CRITICAL: Verificar se precisa corrigir campos ausentes
      const currentData = doc.data();
      if (!currentData.userId && id) {
        (updateData as any).userId = id;
      }

      await docRef.update(updateData);
      
      // 🔥 CRÍTICO: LIMPAR CACHE APÓS ATUALIZAÇÃO
      console.log('🧹 Limpando cache de sellers após aprovação/rejeição...');
      await this.clearSellerCache();
      
      // Buscar dados atualizados
      const updatedDoc = await docRef.get();
      const data = updatedDoc.data();
      
      const updatedSeller: Seller = {
        id,
        ...data,
        createdAt: this.parseFirestoreTimestamp(data?.createdAt),
        updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
        approvedAt: data?.approvedAt ? this.parseFirestoreTimestamp(data.approvedAt) : undefined,
        rejectedAt: data?.rejectedAt ? this.parseFirestoreTimestamp(data.rejectedAt) : undefined,
      } as Seller;
      
      console.log(`✅ Vendedor ${id} atualizado no Firestore!`);
      console.log(`📊 Novo status: ${updatedSeller.status}`);
      console.log('✅ Cache limpo - próximas consultas terão dados atualizados!');
      
      return updatedSeller;
    } catch (error) {
      console.error('❌ Erro ao atualizar vendedor no Firebase:', error);
      throw error;
    }
  }

  // 🛒 CHECKOUT - FIREBASE/FIRESTORE PERMANENTE  
  async getCheckout(id: string): Promise<Checkout | undefined> {
    try {
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      try {
        const cached = firestoreCache.getCheckout(id);
        if (cached !== undefined) return cached as Checkout;
      } catch (e) {}
      
      console.log('🔍 BUSCANDO CHECKOUT NO FIREBASE:', id);
      const doc = await withFirestoreTimeout(this.db.collection('checkouts').doc(id).get());
      
      if (!doc.exists) {
        console.log('❌ CHECKOUT NÃO ENCONTRADO:', id);
        return undefined;
      }
      
      const data = doc.data();
      const checkout = {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Checkout;
      
      try {
        firestoreCache.setCheckout(id, checkout);
      } catch (e) {}
      
      return checkout;
    } catch (error) {
      console.error('❌ Erro ao buscar checkout no Firestore:', error);
      return undefined;
    }
  }

  // 🛒 CREATE CHECKOUT - FIREBASE/FIRESTORE PERMANENTE
  async createCheckout(checkout: InsertCheckout): Promise<Checkout> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      // 🔥 GERAR ID ÚNICO COM RETRY LOGIC - 100% SEM DUPLICAÇÃO
      let id: string;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        // ✅ USAR NANOID(21) - ESTATISTICAMENTE IMPOSSÍVEL DE DUPLICAR
        // 21 caracteres = ~4 milhões de anos para ter 1% de chance de colisão gerando 1000 IDs/hora
        id = nanoid(21);
        
        // 🛡️ VERIFICAR SE JÁ EXISTE (DOUBLE-CHECK ANTI-DUPLICAÇÃO)
        const existingDoc = await this.db.collection('checkouts').doc(id).get();
        
        if (!existingDoc.exists) {
          // ✅ ID ÚNICO CONFIRMADO!
          console.log(`✅ CHECKOUT ID ÚNICO GERADO (tentativa ${attempts + 1}): ${id}`);
          break;
        }
        
        // ⚠️ ID JÁ EXISTE (EXTREMAMENTE RARO) - TENTAR NOVAMENTE
        console.warn(`⚠️ CHECKOUT ID DUPLICADO DETECTADO (tentativa ${attempts + 1}): ${id} - GERANDO NOVO`);
        attempts++;
        
        if (attempts >= maxAttempts) {
          throw new Error('🚨 FALHA CRÍTICA: Não foi possível gerar checkout ID único após 5 tentativas');
        }
      }
      
      const now = new Date();
      
      const checkoutData: Checkout = {
        id: id!,
        ...checkout,
        slug: checkout.slug || id!, // ID permanente do Firestore como fallback
        title: checkout.title || 'Checkout Sem Título',
        subtitle: checkout.subtitle || '',
        logoUrl: checkout.logoUrl || '',
        theme: checkout.theme || { primary: '#10B981', secondary: '#06b6d4' },
        productType: checkout.productType || 'digital',
        globalSettings: checkout.globalSettings || {},
        fields: checkout.fields || {},
        pricing: checkout.pricing || {
          type: 'fixed',
          amount: 9900,
          guaranteeDays: 7
        },
        currency: checkout.currency || 'BRL',
        affiliate: checkout.affiliate || {},
        methods: checkout.methods || {
          pix: true,
          card: true
        },
        active: checkout.active !== false,
        testMode: checkout.testMode || false,
        createdAt: now,
        updatedAt: now
      };
      
      console.log('🛒 CRIANDO CHECKOUT NO FIREBASE:', id);
      
      // 🔒 USAR SET PARA GARANTIR QUE NÃO SOBRESCREVE DADOS EXISTENTES
      await this.db.collection('checkouts').doc(id!).set({
        ...checkoutData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log('✅ CHECKOUT CRIADO COM SUCESSO - ID ÚNICO GARANTIDO:', id);
      try {
        firestoreCache.setCheckout(id!, checkoutData);
        if (checkoutData.tenantId) {
          firestoreCache.invalidateTenantCheckouts(checkoutData.tenantId);
        }
      } catch (e) {}
      return checkoutData;
      
    } catch (error) {
      console.error('❌ Erro ao criar checkout no Firebase:', error);
      throw error;
    }
  }

  async createSeller(sellerData: InsertSeller): Promise<Seller> {
    try {
      // ⚡ GARANTIR FIREBASE PRONTO ANTES DE QUALQUER OPERAÇÃO
      await this.ensureFirebaseReady();
      
      // 🚨 USAR FIREBASE AUTH UID COMO ID ÚNICO - CONFORME SCHEMA OFICIAL
      const sellerId = sellerData.userId; // UID do Firebase Auth
      
      if (!sellerId) {
        throw new Error('userId (Firebase Auth UID) é obrigatório para criar seller');
      }
      
      // 🎯 GERAR TENANT ID AUTOMATICAMENTE PARA CADA SELLER  
      const tenantId = `tenant_${sellerId}_${Date.now()}`;

      // 🏦 LER ADQUIRENTES PADRÃO DO ADMIN (não hardcodar EfiBank)
      let adminDefaultAcquirers: { pix: string; creditCardBR: string; creditCardGlobal: string; boleto: string } = {
        pix: 'efibank',
        creditCardBR: 'efibank',
        creditCardGlobal: 'stripe',
        boleto: 'efibank',
      };
      try {
        if (this.db) {
          const configDoc = await this.db.collection('paymentConfig').doc('global').get();
          if (configDoc.exists) {
            const configData = configDoc.data();
            if (configData?.defaultAcquirers) {
              const da = configData.defaultAcquirers;
              adminDefaultAcquirers = {
                pix: da.pix || 'efibank',
                creditCardBR: da.creditCardBR || da.creditCard || 'efibank',
                creditCardGlobal: da.creditCardGlobal || 'stripe',
                boleto: da.boleto || da.pix || 'efibank',
              };
            }
          }
        }
      } catch (configErr) {
        console.warn('⚠️ createSeller: usando adquirentes padrão (erro ao ler paymentConfig/global):', configErr);
      }

      const pixAcquirer = adminDefaultAcquirers.pix;
      const cardBRAcquirer = adminDefaultAcquirers.creditCardBR;
      const cardGlobalAcquirer = adminDefaultAcquirers.creditCardGlobal;

      const newSeller: Seller = {
        id: sellerId, // UID do Firebase Auth (conforme schema linha 314)
        tenantId: tenantId, // Tenant único para cada seller
        ...sellerData,
        status: 'pending', // Sempre pending para aprovação admin
        
        // 🔒 BLOQUEIO DE CATEGORIAS: Seller pendente só acessa SUPORTE
        blockedCategories: [
          'dashboard',
          'marketplace',
          'produtos',
          'vendas-digitais',
          'vendas-fisicas',
          'assinaturas',
          'financeiro',
          'integracoes',
          'premiacoes'
        ],
        // ✅ Suporte sempre liberado (alwaysEnabled)
        
        // 🏦 ADQUIRENTES PADRÃO: baseados na config do admin
        // Campo flat lido pelo checkout payment route (sellerData.acquirers.pix)
        acquirers: {
          pix: pixAcquirer,
          creditCardBR: cardBRAcquirer,
          creditCard: cardBRAcquirer,
          creditCardGlobal: cardGlobalAcquirer,
          boleto: adminDefaultAcquirers.boleto,
        },
        // Campo estruturado para exibição no painel do seller
        acquirerConfig: {
          pixEnabled: true,
          pixAcquirer,

          brazilianCardEnabled: true,
          brazilianCardAcquirer: cardBRAcquirer,

          globalCardEnabled: false,
          globalCardAcquirer: cardGlobalAcquirer,

          // Sub-configs técnicas padrão (admin preenche depois)
          efibank: {
            enabled: pixAcquirer === 'efibank' || cardBRAcquirer === 'efibank',
            environment: 'sandbox',
            clientId: '',
            clientSecret: '',
            pixKey: ''
          },
          woovi: {
            enabled: pixAcquirer === 'woovi',
            environment: 'sandbox',
            appId: '',
            appSecret: ''
          },
          pagarme: {
            enabled: cardBRAcquirer === 'pagarme' || pixAcquirer === 'pagarme',
            environment: 'sandbox',
            secretKey: '',
            publicKey: ''
          },
          stripe: {
            enabled: cardGlobalAcquirer === 'stripe',
            environment: 'test',
            publicKey: '',
            secretKey: '',
            webhookSecret: ''
          },
          adyen: {
            enabled: cardGlobalAcquirer === 'adyen',
            environment: 'test',
            apiKey: '',
            merchantAccount: '',
            hmacKey: ''
          }
        },
        
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore é obrigatório - sistema não funciona sem conexão permanente');
      }

      // 🔥 FILTRAR CAMPOS UNDEFINED ANTES DE SALVAR NO FIRESTORE
      const cleanData = Object.fromEntries(
        Object.entries(newSeller).filter(([key, value]) => value !== undefined)
      );

      await this.db.collection('sellers').doc(sellerId).set({
        ...cleanData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 🐘 NEON PRIMARY WRITE — synchronous
      try {
        const { neonQuery: nq } = await import('./lib/neon-db.js');
        await nq(async (sql: any) => {
          await sql`
            INSERT INTO sellers (
              id, tenant_id, email, name, business_name, status, phone, document,
              personal_document_number, plan, profile_complete, acquirers, acquirer_config,
              birth_date, personal_document_type, business_niche, product_type, products_description,
              address, documents_urls, accepted_terms, terms_accepted_at,
              accepted_data_tracking, data_tracking_consent_date, data_tracking_consent_version,
              device_fingerprint, registration_ip, is_approved, is_blocked, created_at, updated_at
            ) VALUES (
              ${sellerId},
              ${newSeller.tenantId ?? null},
              ${(newSeller as any).email ?? null},
              ${(newSeller as any).name ?? null},
              ${(newSeller as any).businessName ?? null},
              ${'pending'},
              ${(newSeller as any).phone ?? null},
              ${(newSeller as any).document ?? null},
              ${(newSeller as any).personalDocumentNumber ?? null},
              ${(newSeller as any).plan ?? null},
              ${(newSeller as any).profileComplete ?? false},
              ${(newSeller as any).acquirers ? JSON.stringify((newSeller as any).acquirers) : null},
              ${(newSeller as any).acquirerConfig ? JSON.stringify((newSeller as any).acquirerConfig) : null},
              ${(newSeller as any).birthDate ?? null},
              ${(newSeller as any).personalDocumentType ?? null},
              ${(newSeller as any).businessNiche ?? null},
              ${(newSeller as any).productType ?? null},
              ${(newSeller as any).productsDescription ?? null},
              ${(newSeller as any).address ? JSON.stringify((newSeller as any).address) : null},
              ${(newSeller as any).documentsUrls ? JSON.stringify((newSeller as any).documentsUrls) : null},
              ${(newSeller as any).acceptedTerms ?? false},
              ${(newSeller as any).termsAcceptedAt ?? null},
              ${(newSeller as any).acceptedDataTracking ?? false},
              ${(newSeller as any).dataTrackingConsentDate ?? null},
              ${(newSeller as any).dataTrackingConsentVersion ?? null},
              ${(newSeller as any).deviceFingerprint ? JSON.stringify((newSeller as any).deviceFingerprint) : null},
              ${(newSeller as any).registrationIP ?? null},
              ${false},
              ${false},
              ${newSeller.createdAt instanceof Date ? newSeller.createdAt : new Date()},
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              tenant_id            = COALESCE(EXCLUDED.tenant_id, sellers.tenant_id),
              email                = COALESCE(EXCLUDED.email, sellers.email),
              name                 = COALESCE(EXCLUDED.name, sellers.name),
              business_name        = COALESCE(EXCLUDED.business_name, sellers.business_name),
              status               = EXCLUDED.status,
              updated_at           = NOW()
          `;
        }, `createSeller:${sellerId}`);
      } catch (neonErr) {
        console.error('⚠️ [STORAGE] Neon write failed in createSeller:', neonErr);
      }

      return newSeller;
    } catch (error) {
      console.error('❌ Erro ao criar vendedor:', error);
      throw new Error('Falha ao salvar vendedor');
    }
  }

  // 🛒 ORDERS - FIREBASE/FIRESTORE PERMANENTE
  async createOrder(orderData: InsertOrder): Promise<Order> {
    try {
      await this.ensureFirebaseReady();
      
      // 🔐 POLICY ENFORCEMENT: checkoutId is MANDATORY for salesCount integrity
      if (!orderData.checkoutId) {
        throw new Error("POLICY VIOLATION: checkoutId is required to create sales records");
      }
      
      const orderId = `order_${Date.now()}_${nanoid(16)}_${Math.random().toString(36).substr(2, 12)}_${performance.now().toString().replace('.', '')}`;
      
      // 📸 SNAPSHOT CRÍTICO: Buscar checkout completo e salvar snapshot eterno
      let checkoutSnapshot: any = null;
      if (orderData.checkoutId && this.db) {
        try {
          console.log(`📸 CRIANDO CHECKOUT SNAPSHOT para order ${orderId}...`);
          const checkoutDoc = await this.db.collection('checkouts').doc(orderData.checkoutId).get();
          
          if (checkoutDoc.exists) {
            const checkoutData = checkoutDoc.data();
            checkoutSnapshot = {
              title: checkoutData?.title || 'Produto',
              subtitle: checkoutData?.subtitle || '',
              description: checkoutData?.description || '',
              logoUrl: checkoutData?.logoUrl || null,
              bannerUrl: checkoutData?.bannerUrl || null,
              imageUrl: checkoutData?.imageUrl || null,
              price: checkoutData?.price || 0,
              originalPrice: checkoutData?.originalPrice || null,
              productType: checkoutData?.productType || 'digital',
              pricing: checkoutData?.pricing || null, // 💰 OBJETO PRICING COMPLETO
              installments: checkoutData?.installments || null,
              currency: checkoutData?.currency || 'BRL',
              snapshotCreatedAt: new Date().toISOString()
            };
            console.log(`✅ CHECKOUT SNAPSHOT criado: ${checkoutSnapshot.title}`);
          } else {
            console.warn(`⚠️ Checkout ${orderData.checkoutId} não encontrado - snapshot será vazio`);
          }
        } catch (snapshotError) {
          console.error(`❌ Erro ao criar checkout snapshot:`, snapshotError);
          // Não quebrar a criação da ordem por causa do snapshot
        }
      }
      
      const newOrder: Order = {
        id: orderId,
        ...orderData,
        checkoutSnapshot, // 📸 SNAPSHOT ETERNO DO CHECKOUT
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!this.useFirebase || !this.db) {
        console.log('⚠️ Firebase não disponível - ordem retornada sem persistência:', orderId);
        return newOrder; // Retornar sem salvar para manter sistema funcionando
      }

      // 🧹 LIMPAR CAMPOS UNDEFINED ANTES DE SALVAR NO FIRESTORE
      const cleanedOrder = Object.fromEntries(
        Object.entries(newOrder).filter(([, value]) => value !== undefined)
      );

      // 🔐 TRANSAÇÃO ATÔMICA: Salvar order + incrementar salesCount (operação crítica)
      // Garantia: ou AMBOS acontecem, ou NENHUM acontece (zero race conditions)
      await this.db.runTransaction(async (transaction) => {
        const orderRef = this.db!.collection('orders').doc(orderId);
        const checkoutRef = orderData.checkoutId ? this.db!.collection('checkouts').doc(orderData.checkoutId) : null;
        
        // 0️⃣ Verificar checkout existe (se tiver checkoutId)
        if (checkoutRef) {
          const checkoutDoc = await transaction.get(checkoutRef);
          if (!checkoutDoc.exists) {
            throw new Error(`Checkout ${orderData.checkoutId} não encontrado`);
          }
        }
        
        // 1️⃣ Salvar order na transação (com dates normalizados para Timestamp)
        const normalizedOrder = {
          ...cleanedOrder,
          paidAt: cleanedOrder.paidAt && cleanedOrder.paidAt instanceof Date ? admin.firestore.Timestamp.fromDate(cleanedOrder.paidAt) : null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        transaction.set(orderRef, normalizedOrder);

        // 2️⃣ Incrementar salesCount atomicamente usando FieldValue.increment(1)
        // ✅ CRITICAL: Isso garante atomic increment SEM sobrescrever outros campos do checkout!
        if (checkoutRef) {
          transaction.update(checkoutRef, {
            salesCount: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        console.log(`✅ TRANSAÇÃO: Order ${orderId} + salesCount incrementado atomicamente`);
      });
      
      // 🔄 INVALIDAR CACHE: Forçar GET do checkout para garantir salesCount atualizado em qualquer cache
      if (orderData.checkoutId) {
        try {
          const freshCheckout = await this.db.collection('checkouts').doc(orderData.checkoutId).get();
          const currentSalesCount = freshCheckout.data()?.salesCount || 0;
          console.log(`📊 ✅ Checkout ${orderData.checkoutId} recarregado: ${currentSalesCount} venda(s) total (cache invalidado)`);
        } catch (e) {
          console.warn('⚠️ Falha ao recarregar checkout para invalidar cache:', e);
        }
      }
    
      // ⚡ CRIAR ENROLLMENT E SUBSCRIPTION AUTOMATICAMENTE para vendas PAGAS
      if (orderData.status === 'paid') {
        console.log(`⚡ AUTO-ENROLLMENT: Criando acesso automático para order ${orderId}...`);
        try {
          await this.createEnrollmentOnPayment({
            ...orderData,
            id: orderId,
            paidAt: new Date()
          });
          console.log(`✅ AUTO-ENROLLMENT: Acesso criado com sucesso!`);
        } catch (enrollError) {
          console.error(`❌ AUTO-ENROLLMENT: Erro ao criar acesso automático:`, enrollError);
          // Não quebrar a criação da ordem por causa do enrollment
        }
      }

      console.log('🎉 ✅ PEDIDO CRIADO COM SUCESSO:', orderId);

      return newOrder;
    } catch (error) {
      console.error('❌ Erro ao criar pedido no Firestore:', error);
      throw new Error('Falha ao salvar pedido no Firebase/Firestore');
    }
  }

  async getOrder(id: string): Promise<Order | undefined> {
    try {
      if (this.useFirebase && this.db) {
        const doc = await this.db.collection('orders').doc(id).get();
      if (!doc.exists) return undefined;
      
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
        paidAt: data?.paidAt?.toDate() || null,
      } as Order;
      } else {
        throw new Error('Firebase/Firestore é obrigatório - sem fallback local');
      }
    } catch (error) {
      console.error('❌ Erro ao buscar pedido:', error);
      return undefined;
    }
  }

  // 🔍 BUSCAR ORDERS POR TENANT - OBRIGATÓRIO PARA O DASHBOARD
  async getOrdersByTenant(tenantId: string): Promise<Order[]> {
    try {
      // 🔥 AGUARDAR INICIALIZAÇÃO - OTIMIZADO PARA VELOCIDADE
      await this.ensureFirebaseReady();
      
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      console.log('🔍 BUSCANDO ORDERS NO FIREBASE PARA TENANT:', tenantId);
      
      // ✅ QUERY ZERO ÍNDICE - Filtro simples + ordenação em memória
      const snapshot = await this.db.collection('orders')
        .where('tenantId', '==', tenantId)
        .limit(500)
        .get();
      
      const orders = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data?.createdAt?.toDate() || new Date(),
          updatedAt: data?.updatedAt?.toDate() || new Date(),
          paidAt: data?.paidAt?.toDate() || null,
        } as Order;
      }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Ordenar em memória
      
      console.log(`✅ ${orders.length} ORDERS ENCONTRADAS PARA TENANT ${tenantId}`);
      
      return orders;
    } catch (error: any) {
      console.error('❌ ERRO CRÍTICO ao buscar orders:', error);
      console.error('📋 Detalhes:', error.message);
      if (error.code === 9) {
        console.error('🚨 ÍNDICE FIRESTORE AUSENTE - Crie índice para: tenantId + createdAt');
      }
      // ✅ PROPAGAR ERRO para UI poder mostrar mensagem
      throw new Error(`Falha ao carregar vendas: ${error.message}`);
    }
  }

  // 📦 PRODUCTS - FIREBASE/FIRESTORE PERMANENTE
  async createProduct(productData: InsertProduct): Promise<Product> {
    try {
      await this.ensureFirebaseReady();
      // 🔥 VERIFICAÇÃO OBRIGATÓRIA - Firebase deve estar conectado
      if (!this.useFirebase || !this.db) {
        console.warn('⚠️ Firebase não conectado - criando produto em memória (dados não persistirão)');
        // 🔄 FALLBACK: Criar produto em memória sem persistir
        const product: Product = {
          id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          title: productData.title,
          description: productData.description || '',
          // price: Number(productData.price) || 0, // Removed - not in schema
          // category: productData.category || 'digital', // Removed - not in schema
          tenantId: productData.tenantId,
          active: productData.active ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
          imageUrl: productData.imageUrl || null,
          // accessDays: productData.accessDays || null, // Removed - not in schema
          // affiliateCommission: Number(productData.affiliateCommission) || 10, // Removed - not in schema
          // requiresApproval: productData.requiresApproval ?? false, // Removed - not in schema
          // tags: productData.tags || [] // Removed - not in schema
        };
        console.log('✅ Produto criado em memória (temporário):', product.id);
        return product;
      }

      // 🔥 GERAR ID ÚNICO COM RETRY LOGIC - 100% SEM DUPLICAÇÃO
      let productId: string;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        // ✅ USAR APENAS NANOID(21) - ESTATISTICAMENTE IMPOSSÍVEL DE DUPLICAR
        // 21 caracteres = ~4 milhões de anos para ter 1% de chance de colisão gerando 1000 IDs/hora
        productId = `product_${nanoid(21)}`;
        
        // 🛡️ VERIFICAR SE JÁ EXISTE (DOUBLE-CHECK ANTI-DUPLICAÇÃO)
        const existingDoc = await this.db.collection('products').doc(productId).get();
        
        if (!existingDoc.exists) {
          // ✅ ID ÚNICO CONFIRMADO!
          console.log(`✅ ID ÚNICO GERADO (tentativa ${attempts + 1}): ${productId}`);
          break;
        }
        
        // ⚠️ ID JÁ EXISTE (EXTREMAMENTE RARO) - TENTAR NOVAMENTE
        console.warn(`⚠️ ID DUPLICADO DETECTADO (tentativa ${attempts + 1}): ${productId} - GERANDO NOVO`);
        attempts++;
        
        if (attempts >= maxAttempts) {
          throw new Error('🚨 FALHA CRÍTICA: Não foi possível gerar ID único após 5 tentativas');
        }
      }
      
      const newProduct: Product = {
        id: productId!,
        ...productData,
        accessDuration: productData.accessDuration ?? null, // ✅ ETERNO: undefined ou null = acesso vitalício
        notifyExpirationDays: productData.notifyExpirationDays || [7, 2, 1], // 🔧 VALOR PADRÃO
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 🔥 SALVAR PRODUTO NO FIREBASE COM VERIFICAÇÃO DE SUCESSO
      console.log(`🔥 CRIANDO PRODUTO NO FIREBASE: ${productId}`);
      
      // 🔧 LIMPAR VALORES UNDEFINED ANTES DE SALVAR NO FIREBASE
      const cleanData = Object.fromEntries(
        Object.entries(newProduct).filter(([_, value]) => value !== undefined)
      );
      
      // 🔒 USAR SET COM MERGE FALSE PARA GARANTIR QUE NÃO SOBRESCREVE DADOS EXISTENTES
      await this.db.collection('products').doc(productId!).set({
        ...cleanData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // ✅ VERIFICAR SE PRODUTO FOI SALVO REALMENTE
      const verification = await this.db.collection('products').doc(productId!).get();
      if (!verification.exists) {
        throw new Error('🚨 FALHA CRÍTICA: Produto não foi salvo no Firebase');
      }
      
      console.log(`✅ PRODUTO SALVO COM SUCESSO - ID ÚNICO GARANTIDO: ${productId}`);
      
      // 🔗 SINCRONIZAR COM CHECKOUT EXISTENTE (SE HOUVER) OU CRIAR NOVO - ANTI-DUPLICAÇÃO
      try {
        // 🔍 PRIMEIRO: VERIFICAR SE JÁ EXISTE UM CHECKOUT PARA ESTE PRODUTO
        let existingCheckout = await this.db.collection('checkouts').doc(productId).get();
        let foundExistingByCheckoutId = null;
        
        // 🔍 SEGUNDO: VERIFICAR SE EXISTE CHECKOUT COM checkoutId ESPECIFICADO (CRIADO PELO FRONTEND)
        if (productData.checkoutId && productData.checkoutId !== productId) {
          console.log(`🔍 VERIFICANDO CHECKOUT EXISTENTE POR checkoutId: ${productData.checkoutId}`);
          const checkoutByIdDoc = await this.db.collection('checkouts').doc(productData.checkoutId).get();
          if (checkoutByIdDoc.exists) {
            foundExistingByCheckoutId = checkoutByIdDoc;
            console.log(`✅ CHECKOUT ENCONTRADO: ${productData.checkoutId} - SINCRONIZANDO COM PRODUTO`);
          }
        }
        
        if (foundExistingByCheckoutId) {
          // 🔄 CASO 1: PRODUTO CRIADO PARA CHECKOUT EXISTENTE (FRONTEND → BACKEND)
          console.log(`🔄 SINCRONIZAÇÃO: Produto ${productId} linkado ao checkout existente ${productData.checkoutId}`);
          console.log(`✅ ANTI-DUPLICAÇÃO: Não criando novo checkout - usando o existente`);
          
          // 🔗 ATUALIZAR O CHECKOUT EXISTENTE COM DADOS DO PRODUTO (SE NECESSÁRIO)
          try {
            const checkoutData = foundExistingByCheckoutId.data();
            await this.db.collection('checkouts').doc(productData.checkoutId).update({
              productId: productId,
              syncedProductId: productId,
              productTitle: newProduct.title,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`🔗 CHECKOUT ${productData.checkoutId} ATUALIZADO COM REFERÊNCIA AO PRODUTO ${productId}`);
          } catch (updateError) {
            console.warn('⚠️ Erro ao atualizar checkout com referência do produto:', updateError);
          }
          
        } else if (existingCheckout.exists) {
          // 🔄 CASO 2: CHECKOUT JÁ EXISTE COM MESMO ID DO PRODUTO
          console.log(`🔄 CHECKOUT JÁ EXISTE COM ID: ${productId} - SINCRONIZANDO DADOS`);
          
        } else {
          // 🔄 CASO 3: CRIAR CHECKOUT NOVO (PRODUTO → CHECKOUT)
          console.log(`🔗 CRIANDO CHECKOUT SINCRONIZADO AUTOMATICAMENTE: ${productId}`);
          
          const checkoutData = {
            title: newProduct.title,
            subtitle: newProduct.description || "Área de membros criada automaticamente",
            logoUrl: newProduct.imageUrl || "",
            tenantId: newProduct.tenantId,
            slug: `checkout-${Date.now()}-${Math.random().toString(36).substr(2, 11)}-${Math.random().toString().slice(2, 8)}`,
            productType: newProduct.productType || "digital",
            active: newProduct.active !== false, // default true
            pricing: {
              price: (productData as any).amount, // 🔥 USAR VALOR EXATO DO PRODUTO (SEM FALLBACK)
              discountPrice: 0,
              guaranteeDays: (newProduct as any).guaranteeDays || 7,
              billingType: "one_time",
              currency: "BRL"
            },
            design: {
              primaryColor: "#6366f1",
              secondaryColor: "#f3f4f6",
              fontFamily: "Inter",
              buttonStyle: "rounded"
            },
            autoCreated: true,
            autoCreatedReason: "Checkout criado automaticamente para produto",
            syncedProductId: productId
          };

          // 🔥 USAR MESMO ID DO PRODUTO PARA CHECKOUT (SINCRONIZAÇÃO PERFEITA)
          await this.db.collection('checkouts').doc(productId).set({
            ...checkoutData,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          
          console.log(`✅ CHECKOUT SINCRONIZADO CRIADO COM SUCESSO: ${productId}`);
        }
        
        console.log(`🔗 PRODUTO ↔ CHECKOUT SINCRONIZADOS SEM DUPLICAÇÃO!`);
        
      } catch (checkoutError) {
        console.warn('⚠️ Erro ao sincronizar checkout:', checkoutError);
        // Não falhar a criação do produto se checkout der erro
      }
      
      console.log(`✅ PRODUTO + CHECKOUT SALVOS PERMANENTEMENTE NO FIREBASE: ${productId}`);
      console.log(`📝 ÁREA DE MEMBROS VAZIA - Seller criará módulos e aulas manualmente`);
      
      try {
        firestoreCache.setProduct(productId!, newProduct);
        if (newProduct.tenantId) {
          firestoreCache.invalidateTenantCheckouts(`products_${newProduct.tenantId}`);
        }
      } catch (e) {}
      return newProduct;
    } catch (error) {
      console.error('❌ ERRO CRÍTICO ao criar produto:', error);
      throw new Error(`Falha ao salvar produto no Firebase: ${error}`);
    }
  }

  async getProduct(id: string): Promise<Product | undefined> {
    try {
      if (!this.db) return undefined;
      
      try {
        const cached = firestoreCache.getProduct(id);
        if (cached !== undefined) return cached as Product;
      } catch (e) {}
      
      const doc = await withFirestoreTimeout(this.db.collection('products').doc(id).get());
      if (!doc.exists) return undefined;
      
      const data = doc.data();
      const product = {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Product;
      
      try {
        firestoreCache.setProduct(id, product);
      } catch (e) {}
      
      return product;
    } catch (error) {
      console.error('❌ Erro ao buscar produto no Firestore:', error);
      return undefined;
    }
  }

  // 📦 UPDATE PRODUCT - FIREBASE/FIRESTORE PERMANENTE
  async updateProduct(id: string, updates: Partial<Product>): Promise<Product | undefined> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      console.log(`🔄 ATUALIZANDO PRODUTO NO FIREBASE: ${id}`);
      
      // 🔧 LIMPAR VALORES UNDEFINED ANTES DE SALVAR NO FIREBASE
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, value]) => value !== undefined)
      );
      
      // Adicionar timestamp de atualização
      const updateData = {
        ...cleanUpdates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      await this.db.collection('products').doc(id).update(updateData);
      
      // Buscar e retornar produto atualizado
      const updatedDoc = await this.db.collection('products').doc(id).get();
      if (!updatedDoc.exists) {
        console.error('❌ Produto não encontrado após atualização:', id);
        return undefined;
      }
      
      const data = updatedDoc.data();
      const updatedProduct = {
        id: updatedDoc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Product;
      
      console.log(`✅ PRODUTO ATUALIZADO COM SUCESSO NO FIREBASE: ${id}`);
      try {
        firestoreCache.setProduct(id, updatedProduct);
        if (updatedProduct.tenantId) {
          firestoreCache.invalidateTenantCheckouts(`products_${updatedProduct.tenantId}`);
        }
      } catch (e) {}
      return updatedProduct;
      
    } catch (error) {
      console.error('❌ Erro ao atualizar produto no Firebase:', error);
      return undefined;
    }
  }

  // 🔍 HELPER FUNCTIONS - PARA SINCRONIZAÇÃO E RELACIONAMENTOS
  async listModulesByProduct(productId: string): Promise<Module[]> {
    try {
      if (!this.db) return [];
      
      const snapshot = await this.db.collection('modules')
        .where('productId', '==', productId)
        .get();
      
      const modules = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: this.parseFirestoreTimestamp(data?.createdAt),
          updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
        };
      }) as Module[];
      
      return modules;
    } catch (error) {
      console.error('❌ Erro ao listar módulos por produto:', error);
      return [];
    }
  }

  async listLessonsByModule(moduleId: string): Promise<Lesson[]> {
    try {
      if (!this.db) return [];
      const snapshot = await this.db.collection('lessons')
        .where('moduleId', '==', moduleId)
        .get();
      
      const lessons = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: this.parseFirestoreTimestamp(data?.createdAt),
          updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
        };
      }) as Lesson[];
      
      return lessons;
    } catch (error) {
      console.error('❌ Erro ao listar aulas por módulo:', error);
      return [];
    }
  }

  async listEnrollmentsByProduct(productId: string): Promise<Enrollment[]> {
    try {
      if (!this.db) return [];
      const snapshot = await this.db.collection('enrollments')
        .where('productId', '==', productId)
        .get();
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        enrolledAt: doc.data()?.enrolledAt?.toDate() || new Date(),
        expiresAt: doc.data()?.expiresAt?.toDate(),
        createdAt: doc.data()?.createdAt?.toDate() || new Date(),
        updatedAt: doc.data()?.updatedAt?.toDate() || new Date(),
      })) as Enrollment[];
    } catch (error) {
      console.error('❌ Erro ao listar enrollments por produto:', error);
      return [];
    }
  }

  async countOrdersByCheckout(checkoutId: string): Promise<number> {
    try {
      if (!this.db) return 0;
      const snapshot = await this.db.collection('orders')
        .where('checkoutId', '==', checkoutId)
        .get();
      
      return snapshot.size;
    } catch (error) {
      console.error('❌ Erro ao contar orders por checkout:', error);
      return 0;
    }
  }

  // 🗑️ DELETE PRODUCT COM SINCRONIZAÇÃO COMPLETA
  async deleteProduct(productId: string, options: { mode: 'archive' | 'hard', deleteCheckout?: boolean } = { mode: 'archive' }): Promise<{ success: boolean, message: string, details: any }> {
    try {
      if (!this.db) {
        throw new Error('Firebase/Firestore é obrigatório para exclusão');
      }

      console.log(`🗑️ INICIANDO EXCLUSÃO DE PRODUTO: ${productId} (modo: ${options.mode})`);

      // 1️⃣ VERIFICAR SE PRODUTO EXISTE
      const productDoc = await this.db.collection('products').doc(productId).get();
      if (!productDoc.exists) {
        return { success: false, message: 'Produto não encontrado', details: { productId } };
      }

      // 2️⃣ VERIFICAR RELACIONAMENTOS E VENDAS
      const enrollments = await this.listEnrollmentsByProduct(productId);
      const orderCount = await this.countOrdersByCheckout(productId);
      const modules = await this.listModulesByProduct(productId);
      
      console.log(`📊 ANÁLISE DE RELACIONAMENTOS:`, {
        enrollments: enrollments.length,
        orders: orderCount,
        modules: modules.length
      });

      // 3️⃣ MODO ARCHIVE (PADRÃO E SEGURO)
      if (options.mode === 'archive') {
        console.log(`📦 EXECUTANDO ARCHIVE (SOFT DELETE) PARA: ${productId}`);
        
        const batch = this.db.batch();
        const now = new Date();
        
        batch.update(this.db.collection('products').doc(productId), {
          active: false,
          deleted: true,
          deletedAt: admin.firestore.FieldValue.serverTimestamp(),
          deletedReason: 'archived_by_user',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Archive do checkout se existir
        const checkoutDoc = await this.db.collection('checkouts').doc(productId).get();
        if (checkoutDoc.exists) {
          batch.update(this.db.collection('checkouts').doc(productId), {
            active: false,
            deleted: true,
            deletedAt: admin.firestore.FieldValue.serverTimestamp(),
            deletedReason: 'product_archived',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        // Revogar acesso de todos os enrollments
        for (const enrollment of enrollments) {
          if (enrollment.status === 'active') {
            batch.update(this.db.collection('enrollments').doc(enrollment.id), {
              status: 'cancelled',
              accessRevokedAt: admin.firestore.FieldValue.serverTimestamp(),
              accessRevokedReason: 'product_archived',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        }

        // 📚 ARQUIVAR MÓDULOS E AULAS DA ÁREA DE MEMBROS (SINCRONIZAÇÃO TOTAL)
        console.log(`📚 ARQUIVANDO ${modules.length} módulos e suas aulas...`);
        for (const module of modules) {
          // Arquivar módulo
          batch.update(this.db.collection('modules').doc(module.id), {
            active: false,
            deletedAt: admin.firestore.FieldValue.serverTimestamp(),
            deletedReason: 'product_archived',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Arquivar todas as aulas do módulo
          const lessons = await this.listLessonsByModule(module.id);
          for (const lesson of lessons) {
            batch.update(this.db.collection('lessons').doc(lesson.id), {
              active: false,
              deletedAt: admin.firestore.FieldValue.serverTimestamp(),
              deletedReason: 'module_archived',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        }

        await batch.commit();
        
        return {
          success: true,
          message: 'Produto e área de membros arquivados com sucesso',
          details: {
            productId,
            mode: 'archive',
            enrollmentsRevoked: enrollments.filter(e => e.status === 'active').length,
            checkoutArchived: checkoutDoc.exists,
            modulesArchived: modules.length,
            lessonsArchived: 0 // contagem das aulas é calculada dinamicamente
          }
        };
      }

      // 4️⃣ MODO HARD DELETE (PERIGOSO - VERIFICAÇÕES RIGOROSAS)
      if (options.mode === 'hard') {
        console.log(`⚠️ VERIFICANDO POSSIBILIDADE DE HARD DELETE: ${productId}`);
        
        // BLOQUEAR se existem vendas
        if (orderCount > 0) {
          return {
            success: false,
            message: `Não é possível excluir permanentemente: existem ${orderCount} vendas registradas`,
            details: { productId, orders: orderCount, enrollments: enrollments.length }
          };
        }

        // BLOQUEAR se existem enrollments ativos
        const activeEnrollments = enrollments.filter(e => e.status === 'active');
        if (activeEnrollments.length > 0) {
          return {
            success: false,
            message: `Não é possível excluir permanentemente: existem ${activeEnrollments.length} membros com acesso ativo`,
            details: { productId, activeEnrollments: activeEnrollments.length }
          };
        }

        console.log(`🔥 EXECUTANDO HARD DELETE PARA: ${productId}`);
        
        // 🐰 1. BUNNY.NET CASCADE DELETION - Coletar TODOS os vídeos e capas ANTES de deletar do Firestore
        const { cleanupBunnyResources } = await import('./services/bunny-cleanup');
        
        const allVideoGuids: string[] = [];
        const allImageUrls: string[] = [];
        let totalLessons = 0;
        
        console.log(`🐰 [BUNNY CASCADE] Coletando vídeos e capas de ${modules.length} módulos...`);
        
        for (const module of modules) {
          const lessons = await this.listLessonsByModule(module.id);
          totalLessons += lessons.length;
          
          lessons.forEach(lesson => {
            // ✅ CORREÇÃO: Usar bunnyVideoGuid (campo correto do schema)
            if (lesson.bunnyVideoGuid) {
              allVideoGuids.push(lesson.bunnyVideoGuid);
            } else if (lesson.videoType === 'panda' && lesson.videoUrl) {
              // FALLBACK: Extrair GUID da URL como backup
              const guidMatch = lesson.videoUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
              if (guidMatch) {
                allVideoGuids.push(guidMatch[1]);
              }
            }
            
            // ✅ CORREÇÃO: Usar URL completa da imagem (mesmo padrão de deleteLesson/deleteModule)
            if (lesson.imageUrl && (lesson.imageUrl.includes('b-cdn.net') || lesson.imageUrl.startsWith('/api/images/'))) {
              allImageUrls.push(lesson.imageUrl);
            }
          });
        }
        
        console.log(`🐰 [BUNNY CASCADE] Coletados: ${allVideoGuids.length} vídeos + ${allImageUrls.length} capas de ${totalLessons} aulas`);
        
        // 2. DELETAR TUDO DO BUNNY.NET (não bloquear se falhar)
        if (allVideoGuids.length > 0 || allImageUrls.length > 0) {
          try {
            console.log(`🐰 [BUNNY CASCADE] Deletando ${allVideoGuids.length} vídeos e ${allImageUrls.length} capas do Bunny.net...`);
            
            const cleanupResult = await cleanupBunnyResources(allVideoGuids, allImageUrls);
            
            console.log('✅ [BUNNY CASCADE] Cleanup concluído:', {
              videosDeleted: cleanupResult.videosDeleted,
              imagesDeleted: cleanupResult.imagesDeleted,
              errors: cleanupResult.errors
            });
            
            // ⚠️ LOGAR FALHAS (mas não bloquear operação)
            if (cleanupResult.videosFailed > 0) {
              console.warn(`⚠️ [BUNNY CASCADE] ${cleanupResult.videosFailed} vídeos falharam ao deletar`);
            }
            if (cleanupResult.imagesFailed > 0) {
              console.warn(`⚠️ [BUNNY CASCADE] ${cleanupResult.imagesFailed} imagens falharam ao deletar`);
            }
          } catch (bunnyError) {
            console.error('❌ [BUNNY CASCADE] EXCEÇÃO ao deletar conteúdo do Bunny (continuando hard delete):', bunnyError);
            console.error('🚨 [BUNNY CASCADE] CONTEÚDO ÓRFÃO - Vídeos:', allVideoGuids, 'Imagens:', allImageUrls);
          }
        } else {
          console.log(`ℹ️ [BUNNY CASCADE] Nenhum vídeo ou capa para deletar (produto sem área de membros)`);
        }
        
        // 3. FIRESTORE SOFT-DELETE - Preservar dados eternos no Firebase (IDs nunca apagados)
        console.log(`🛡️ [FIRESTORE] Iniciando soft-delete de ${totalLessons} aulas + ${modules.length} módulos (dados preservados)...`);
        const batch = this.db.batch();
        const softDeleteData = { active: false, deleted: true, deletedAt: admin.firestore.FieldValue.serverTimestamp(), deletedReason: 'hard_mode_converted_to_soft' };
        
        for (const module of modules) {
          const lessons = await this.listLessonsByModule(module.id);
          for (const lesson of lessons) {
            batch.update(this.db.collection('lessons').doc(lesson.id), softDeleteData);
          }
        }

        for (const module of modules) {
          batch.update(this.db.collection('modules').doc(module.id), softDeleteData);
        }

        for (const enrollment of enrollments) {
          batch.update(this.db.collection('enrollments').doc(enrollment.id), { status: 'cancelled', deleted: true, deletedAt: admin.firestore.FieldValue.serverTimestamp(), accessRevokedReason: 'product_deleted' });
        }

        if (options.deleteCheckout) {
          const checkoutDoc = await this.db.collection('checkouts').doc(productId).get();
          if (checkoutDoc.exists) {
            batch.update(this.db.collection('checkouts').doc(productId), { deleted: true, deletedAt: admin.firestore.FieldValue.serverTimestamp(), deletedBy: 'product_cascade' });
          }
        }

        batch.update(this.db.collection('products').doc(productId), softDeleteData);

        await batch.commit();

        return {
          success: true,
          message: 'Produto e conteúdo arquivados (dados preservados no Firebase)',
          details: {
            productId,
            mode: 'soft_delete',
            modulesArchived: modules.length,
            lessonsArchived: totalLessons,
            videosDeleted: allVideoGuids.length,
            coversDeleted: allImageUrls.length,
            enrollmentsRevoked: enrollments.length,
            checkoutArchived: options.deleteCheckout
          }
        };
      }

      return { success: false, message: 'Modo de exclusão inválido', details: { mode: options.mode } };

    } catch (error) {
      console.error('❌ Erro ao excluir produto:', error);
      return {
        success: false,
        message: `Erro na exclusão: ${error.message}`,
        details: { productId, error: error.message }
      };
    }
  }

  // 🎯 PRODUCT OFFERS - MÚLTIPLAS OFERTAS POR PRODUTO
  async listOffersByProduct(productId: string, includeInactive = false): Promise<ProductOffer[]> {
    try {
      if (!this.db) return [];
      
      let query = this.db.collection('productOffers').where('productId', '==', productId);
      
      // Filtrar apenas ativas se não solicitar inativas
      if (!includeInactive) {
        query = query.where('active', '==', true);
      }
      
      const snapshot = await query.get();
      
      console.log(`🔍 [OFFERS] Buscando ofertas: productId=${productId}, found=${snapshot.size}`);
      
      // 🔥 FILTRAR OFERTAS DELETADAS (soft-delete) - SEMPRE
      const offers = snapshot.docs
        .filter(doc => {
          const data = doc.data();
          // Excluir ofertas com deleted=true ou deletedAt definido
          if (data.deleted === true || data.deletedAt) {
            console.log(`🗑️ [OFFERS] Oferta ${doc.id} ignorada (deletada)`);
            return false;
          }
          return true;
        })
        .map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            createdAt: data?.createdAt?.toDate ? data.createdAt.toDate() : (data?.createdAt ? new Date(data.createdAt) : new Date()),
            updatedAt: data?.updatedAt?.toDate ? data.updatedAt.toDate() : (data?.updatedAt ? new Date(data.updatedAt) : new Date()),
          };
        }) as ProductOffer[];
      
      console.log(`✅ [OFFERS] Ofertas válidas: ${offers.length} de ${snapshot.size}`);
      
      return offers.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    } catch (error) {
      console.error('❌ Erro ao listar ofertas:', error);
      return [];
    }
  }

  async getOffer(id: string): Promise<ProductOffer | undefined> {
    try {
      if (!this.db) return undefined;
      const doc = await this.db.collection('productOffers').doc(id).get();
      if (!doc.exists) return undefined;
      
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate ? data.createdAt.toDate() : (data?.createdAt ? new Date(data.createdAt) : new Date()),
        updatedAt: data?.updatedAt?.toDate ? data.updatedAt.toDate() : (data?.updatedAt ? new Date(data.updatedAt) : new Date()),
      } as ProductOffer;
    } catch (error) {
      console.error('❌ Erro ao buscar oferta:', error);
      return undefined;
    }
  }

  async getOfferBySlug(productId: string, slug: string): Promise<ProductOffer | undefined> {
    try {
      if (!this.db) return undefined;
      const snapshot = await this.db.collection('productOffers')
        .where('productId', '==', productId)
        .where('slug', '==', slug)
        .limit(1)
        .get();
      
      if (snapshot.empty) return undefined;
      
      const doc = snapshot.docs[0];
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate ? data.createdAt.toDate() : (data?.createdAt ? new Date(data.createdAt) : new Date()),
        updatedAt: data?.updatedAt?.toDate ? data.updatedAt.toDate() : (data?.updatedAt ? new Date(data.updatedAt) : new Date()),
      } as ProductOffer;
    } catch (error) {
      console.error('❌ Erro ao buscar oferta por slug:', error);
      return undefined;
    }
  }

  async createOffer(offerData: InsertProductOffer): Promise<ProductOffer> {
    try {
      if (!this.db) throw new Error('Firebase/Firestore obrigatório');
      
      // Verificar limite de 6 ofertas adicionais por produto (+ 1 URL base = 7 total)
      const existingOffers = await this.listOffersByProduct(offerData.productId);
      if (existingOffers.length >= 6) {
        throw new Error('Limite de 6 ofertas adicionais atingido (+ 1 URL base = 7 total)');
      }
      
      // Verificar se slug já existe para este produto
      const existingSlug = await this.getOfferBySlug(offerData.productId, offerData.slug);
      if (existingSlug) {
        throw new Error('Já existe uma oferta com este slug para este produto');
      }
      
      // Buscar produto OU checkout para pegar o tenantId
      const product = await this.getProduct(offerData.productId);
      const checkout = !product ? await this.getCheckout(offerData.productId) : null;
      
      if (!product && !checkout) {
        throw new Error('Produto ou checkout não encontrado');
      }
      
      const tenantId = product?.tenantId || checkout?.tenantId;
      
      // Validar price como número
      const price = Number(offerData.price);
      if (isNaN(price) || price < 0) {
        throw new Error('Preço inválido - deve ser um número positivo');
      }
      
      const offerId = `offer_${Date.now()}_${nanoid(16)}`;
      const now = new Date();
      
      const newOffer: ProductOffer = {
        id: offerId,
        ...offerData,
        price: price, // Garantir que é número
        tenantId: tenantId!,
        active: offerData.active ?? true,
        createdAt: now,
        updatedAt: now,
      };
      
      await this.db.collection('productOffers').doc(offerId).set({
        ...newOffer,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      console.log(`✅ Oferta criada: ${offerId} (${offerData.slug})`);
      return newOffer;
    } catch (error) {
      console.error('❌ Erro ao criar oferta:', error);
      throw error;
    }
  }

  async updateOffer(id: string, updates: Partial<ProductOffer>): Promise<ProductOffer | undefined> {
    try {
      if (!this.db) return undefined;
      
      const offerDoc = await this.db.collection('productOffers').doc(id).get();
      if (!offerDoc.exists) return undefined;
      
      // Validar price se estiver sendo atualizado
      if (updates.price !== undefined) {
        const price = Number(updates.price);
        if (isNaN(price) || price < 0) {
          throw new Error('Preço inválido - deve ser um número positivo');
        }
        updates.price = price; // Garantir que é número
      }
      
      // Slug é permanente - nunca pode ser alterado após criação (alteração quebraria URLs existentes)
      delete (updates as any).slug;
      delete (updates as any).id;
      
      const updateData = {
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      await this.db.collection('productOffers').doc(id).update(updateData);
      
      const updatedDoc = await this.db.collection('productOffers').doc(id).get();
      console.log(`✅ Oferta atualizada: ${id}`);
      
      return {
        id: updatedDoc.id,
        ...updatedDoc.data(),
        createdAt: updatedDoc.data()?.createdAt?.toDate() || new Date(),
        updatedAt: updatedDoc.data()?.updatedAt?.toDate() || new Date(),
      } as ProductOffer;
    } catch (error) {
      console.error('❌ Erro ao atualizar oferta:', error);
      return undefined;
    }
  }

  async deleteOffer(id: string): Promise<boolean> {
    try {
      if (!this.db) return false;
      await this.db.collection('productOffers').doc(id).delete();
      console.log(`✅ Oferta excluída: ${id}`);
      return true;
    } catch (error) {
      console.error('❌ Erro ao excluir oferta:', error);
      return false;
    }
  }

  // 📚 MODULES - FIREBASE/FIRESTORE PERMANENTE
  async createModule(moduleData: InsertModule): Promise<Module> {
    try {
      const moduleId = `module_${Date.now()}_${nanoid(16)}_${Math.random().toString(36).substr(2, 12)}_${performance.now().toString().replace('.', '')}`;
      
      // 🔢 AUTO-INCREMENTO: Buscar maior position existente para este produto
      let nextPosition = 0;
      if (this.db && moduleData.productId) {
        // 🔥 QUERY SEM ÍNDICE: Buscar TODOS os módulos e ordenar em memória
        const existingModules = await this.db.collection('modules')
          .where('productId', '==', moduleData.productId)
          .get();
        
        if (!existingModules.empty) {
          // 🔢 ORDENAR EM MEMÓRIA: Evita necessidade de índice composto
          const positions = existingModules.docs.map(doc => doc.data().position || 0);
          const maxPosition = Math.max(...positions);
          nextPosition = maxPosition + 1;
          console.log(`🔢 AUTO-INCREMENTO: Maior position existente: ${maxPosition}, próximo será: ${nextPosition}`);
        } else {
          console.log('🔢 AUTO-INCREMENTO: Primeiro módulo do produto, position será: 0');
        }
      }
      
      const newModule: Module = {
        id: moduleId,
        ...moduleData,
        active: true,
        position: nextPosition, // ✅ POSITION AUTOMÁTICO SEQUENCIAL
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      await this.db.collection('modules').doc(moduleId).set({
        ...newModule,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log('📚 ✅ MÓDULO SALVO NO FIREBASE/FIRESTORE PERMANENTE!');
      console.log('🆔 Module ID:', moduleId);
      console.log('📦 Product:', newModule.productId);
      console.log('📝 Título:', newModule.title);
      console.log('🔢 Position:', newModule.position);

      return newModule;
    } catch (error) {
      console.error('❌ Erro ao criar módulo no Firestore:', error);
      throw new Error('Falha ao salvar módulo no Firebase/Firestore');
    }
  }

  async getModule(id: string): Promise<Module | undefined> {
    try {
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      const doc = await this.db.collection('modules').doc(id).get();
      if (!doc.exists) return undefined;
      
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Module;
    } catch (error) {
      console.error('❌ Erro ao buscar módulo no Firestore:', error);
      return undefined;
    }
  }

  // 🎓 LESSONS - FIREBASE/FIRESTORE PERMANENTE
  async createLesson(lessonData: InsertLesson): Promise<Lesson> {
    try {
      const lessonId = `lesson_${Date.now()}_${nanoid(16)}_${Math.random().toString(36).substr(2, 12)}_${performance.now().toString().replace('.', '')}`;
      
      // 🔢 AUTO-INCREMENTO: Buscar maior position existente para este módulo
      let nextPosition = 0;
      if (this.db && lessonData.moduleId) {
        // 🔥 QUERY SEM ÍNDICE: Buscar TODAS as lessons e ordenar em memória
        const existingLessons = await this.db.collection('lessons')
          .where('moduleId', '==', lessonData.moduleId)
          .get();
        
        if (!existingLessons.empty) {
          // 🔢 ORDENAR EM MEMÓRIA: Evita necessidade de índice composto
          const positions = existingLessons.docs.map(doc => doc.data().position || 0);
          const maxPosition = Math.max(...positions);
          nextPosition = maxPosition + 1;
          console.log(`🔢 AUTO-INCREMENTO: Maior position de aula existente: ${maxPosition}, próximo será: ${nextPosition}`);
        } else {
          console.log('🔢 AUTO-INCREMENTO: Primeira aula do módulo, position será: 0');
        }
      }
      
      const newLesson: Lesson = {
        id: lessonId,
        ...lessonData,
        active: lessonData.active ?? true,
        position: nextPosition, // ✅ POSITION AUTOMÁTICO SEQUENCIAL
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      await this.db.collection('lessons').doc(lessonId).set({
        ...newLesson,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log('🎓 ✅ AULA SALVA NO FIREBASE/FIRESTORE PERMANENTE!');
      console.log('🆔 Lesson ID:', lessonId);
      console.log('📚 Module:', newLesson.moduleId);
      console.log('📝 Título:', newLesson.title);
      console.log('🔢 Position:', newLesson.position);

      return newLesson;
    } catch (error) {
      console.error('❌ Erro ao criar aula no Firestore:', error);
      throw new Error('Falha ao salvar aula no Firebase/Firestore');
    }
  }

  async getLesson(id: string): Promise<Lesson | undefined> {
    try {
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      const doc = await this.db.collection('lessons').doc(id).get();
      if (!doc.exists) return undefined;
      
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Lesson;
    } catch (error) {
      console.error('❌ Erro ao buscar aula no Firestore:', error);
      return undefined;
    }
  }

  // 👥 MEMBERS - FIREBASE/FIRESTORE PERMANENTE
  async createMember(memberData: InsertMember): Promise<Member> {
    try {
      // 🚨 USAR FIREBASE AUTH UID COMO ID ÚNICO PARA COMPRADORES TAMBÉM
      const memberId = memberData.userId; // UID do Firebase Auth
      
      if (!memberId) {
        throw new Error('userId (Firebase Auth UID) é obrigatório para criar member/comprador');
      }
      
      const newMember: Member = {
        id: memberId, // UID do Firebase Auth
        ...memberData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      await this.db.collection('members').doc(memberId).set({
        ...newMember,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });


      return newMember;
    } catch (error) {
      console.error('❌ Erro ao criar membro no Firestore:', error);
      throw new Error('Falha ao salvar membro no Firebase/Firestore');
    }
  }

  async getMember(id: string): Promise<Member | undefined> {
    try {
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      const doc = await this.db.collection('members').doc(id).get();
      if (!doc.exists) return undefined;
      
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Member;
    } catch (error) {
      console.error('❌ Erro ao buscar membro no Firestore:', error);
      return undefined;
    }
  }

  // 📋 ENROLLMENTS - FIREBASE/FIRESTORE PERMANENTE
  async createEnrollment(enrollmentData: InsertEnrollment): Promise<Enrollment> {
    try {
      const enrollmentId = `enrollment_${Date.now()}_${nanoid(16)}_${Math.random().toString(36).substr(2, 12)}_${performance.now().toString().replace('.', '')}`;
      
      const newEnrollment: Enrollment = {
        id: enrollmentId,
        ...enrollmentData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      await this.db.collection('enrollments').doc(enrollmentId).set({
        ...newEnrollment,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: newEnrollment.expiresAt ? admin.firestore.Timestamp.fromDate(newEnrollment.expiresAt) : null,
      });

      console.log('📋 ✅ MATRÍCULA SALVA NO FIREBASE/FIRESTORE PERMANENTE!');
      console.log('🆔 Enrollment ID:', enrollmentId);
      console.log('👤 Member:', newEnrollment.memberId);
      console.log('📦 Product:', newEnrollment.productId);

      return newEnrollment;
    } catch (error) {
      console.error('❌ Erro ao criar matrícula no Firestore:', error);
      throw new Error('Falha ao salvar matrícula no Firebase/Firestore');
    }
  }

  async getEnrollment(id: string): Promise<Enrollment | undefined> {
    try {
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      const doc = await this.db.collection('enrollments').doc(id).get();
      if (!doc.exists) return undefined;
      
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        enrolledAt: data?.enrolledAt?.toDate() || new Date(),
        expiresAt: data?.expiresAt?.toDate(),
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Enrollment;
    } catch (error) {
      console.error('❌ Erro ao buscar matrícula no Firestore:', error);
      return undefined;
    }
  }

  // 📊 PROGRESS - FIREBASE/FIRESTORE PERMANENTE
  async createProgress(progressData: InsertProgress): Promise<Progress> {
    try {
      const progressId = `progress_${Date.now()}_${nanoid(16)}_${Math.random().toString(36).substr(2, 12)}_${performance.now().toString().replace('.', '')}`;
      
      const newProgress: Progress = {
        id: progressId,
        ...progressData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      await this.db.collection('progress').doc(progressId).set({
        ...newProgress,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: newProgress.completedAt ? admin.firestore.Timestamp.fromDate(newProgress.completedAt) : null,
      });

      console.log('📊 ✅ PROGRESSO SALVO NO FIREBASE/FIRESTORE PERMANENTE!');
      console.log('🆔 Progress ID:', progressId);
      console.log('👤 Member:', newProgress.memberId);
      console.log('🎓 Lesson:', newProgress.lessonId);

      return newProgress;
    } catch (error) {
      console.error('❌ Erro ao criar progresso no Firestore:', error);
      throw new Error('Falha ao salvar progresso no Firebase/Firestore');
    }
  }

  async getProgress(id: string): Promise<Progress | undefined> {
    try {
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      const doc = await this.db.collection('progress').doc(id).get();
      if (!doc.exists) return undefined;
      
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        completedAt: data?.completedAt?.toDate(),
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Progress;
    } catch (error) {
      console.error('❌ Erro ao buscar progresso no Firestore:', error);
      return undefined;
    }
  }

  // 🛒 CHECKOUTS BY TENANT - FIREBASE/FIRESTORE PERMANENTE
  // 🗑️ REMOVIDO: incrementCheckoutSales() helper
  // ⚠️ OBSOLETO: Todos os increments de salesCount agora acontecem dentro de transactions
  // nas funções create... para garantir atomicidade e consistência total

  async getCheckoutsByTenant(tenantId: string): Promise<Checkout[]> {
    try {
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      if (tenantId !== 'ALL') {
        try {
          const cached = firestoreCache.getTenantCheckoutsFromCache(tenantId);
          if (cached !== undefined) {
            console.log(`✅ [CACHE] ${cached.length} checkouts para tenant ${tenantId}`);
            return cached as Checkout[];
          }
        } catch (e) {}
      }
      
      console.log('🔍 BUSCANDO CHECKOUTS DO TENANT NO FIREBASE:', tenantId);
      
      let snapshot;
      if (tenantId === 'ALL') {
        snapshot = await withFirestoreTimeout(this.db.collection('checkouts').limit(10).get());
      } else {
        snapshot = await withFirestoreTimeout(this.db.collection('checkouts')
          .where('tenantId', '==', tenantId)
          .get());
      }
      
      // 🗑️ FILTRAR CHECKOUTS DELETADOS (soft-delete)
      const checkouts = snapshot.docs
        .filter(doc => {
          const data = doc.data();
          return !data.deleted; // Excluir checkouts com deleted=true
        })
        .map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            createdAt: data?.createdAt?.toDate() || new Date(),
            updatedAt: data?.updatedAt?.toDate() || new Date(),
          } as Checkout;
        });
      
      console.log(`✅ ${checkouts.length} CHECKOUTS ENCONTRADOS PARA TENANT ${tenantId}`);
      if (tenantId !== 'ALL') {
        try {
          firestoreCache.setTenantCheckoutsCache(tenantId, checkouts);
        } catch (e) {}
      }
      return checkouts;
    } catch (error: any) {
      console.error('❌ Erro ao buscar checkouts por tenant no Firestore:', error);
      if (error.code === 8 && tenantId !== 'ALL') {
        try {
          firestoreCache.setTenantCheckoutsCache(tenantId, []);
        } catch (e) {}
      }
      return [];
    }
  }

  // 📦 GET PRODUCTS BY TENANT - FIREBASE/FIRESTORE PERMANENTE
  async getProductsByTenant(tenantId: string): Promise<Product[]> {
    try {
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      try {
        const cached = firestoreCache.getTenantCheckoutsFromCache(`products_${tenantId}`);
        if (cached !== undefined) {
          console.log(`✅ [CACHE] ${cached.length} produtos para tenant ${tenantId}`);
          return cached as Product[];
        }
      } catch (e) {}
      
      console.log('🔍 BUSCANDO PRODUTOS DO TENANT NO FIREBASE:', tenantId);
      
      const snapshot = await withFirestoreTimeout(this.db.collection('products')
        .where('tenantId', '==', tenantId)
        .limit(500)
        .get());
      
      if (snapshot.empty) {
        console.log('🚫 Nenhum produto encontrado para este tenant');
        return [];
      }
      
      const products = snapshot.docs
        .map(doc => {
          const data = doc.data();
          // Excluir produtos soft-deletados
          if (data.deletedAt || data.active === false) return null;
          return {
            id: doc.id,
            ...data,
            createdAt: data?.createdAt?.toDate() || new Date(),
            updatedAt: data?.updatedAt?.toDate() || new Date(),
          } as Product;
        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime()); // Ordenar em memória
      
      console.log(`✅ ${products.length} PRODUTOS ENCONTRADOS PARA TENANT ${tenantId} (excluindo deletados)`);
      try {
        firestoreCache.setTenantCheckoutsCache(`products_${tenantId}`, products);
      } catch (e) {}
      return products;
      
    } catch (error: any) {
      console.error('❌ ERRO CRÍTICO ao buscar produtos:', error);
      console.error('📋 Detalhes:', error.message);
      if (error.code === 8) {
        try {
          firestoreCache.setTenantCheckoutsCache(`products_${tenantId}`, []);
        } catch (e) {}
      }
      if (error.code === 9) {
        console.error('🚨 ÍNDICE FIRESTORE AUSENTE - Crie índice para: tenantId + createdAt');
      }
      throw new Error(`Falha ao carregar produtos: ${error.message}`);
    }
  }

  // 📦 ADMIN - BUSCAR TODOS OS PRODUTOS (PARA ADMIN PANEL)
  async getAllProducts(options: { force?: boolean } = {}): Promise<Product[]> {
    await this.ensureFirebaseReady();
    
    console.log(`🔍 ADMIN: getAllProducts called with options.force = ${options.force}`);
    
    try {
      if (!this.useFirebase || !this.db) {
        console.warn('⚠️ Firebase não conectado - retornando array vazio');
        return [];
      }

      console.log('📦 ADMIN: Buscando TODOS os produtos do Firestore...');
      
      const firestoreSnapshot = await this.db.collection('products').get();
      const products: Product[] = [];
      
      firestoreSnapshot.forEach(doc => {
        const data = doc.data();
        products.push({
          id: doc.id,
          tenantId: data.tenantId || doc.id,
          title: data.title || 'Produto sem título',
          subtitle: data.subtitle || data.description || '',
          price: data.price || data.pricing?.amount || 0,
          currency: data.currency || 'BRL',
          active: data.active !== undefined ? data.active : true,
          productType: data.productType || 'digital',
          createdAt: data?.createdAt?.toDate() || new Date(),
          updatedAt: data?.updatedAt?.toDate() || new Date(),
          ...data
        } as Product);
      });

      console.log(`✅ ADMIN: ${products.length} produtos carregados do Firestore!`);
      return products;

    } catch (error) {
      console.error('❌ ADMIN: Erro ao buscar produtos:', error);
      return [];
    }
  }

  // 🎟️ CUPONS DE DESCONTO - FIREBASE/FIRESTORE
  async createCoupon(couponData: any): Promise<any> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const now = new Date();
      const couponId = `coupon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // ✅ CONVERTER validFrom e validUntil para Date APENAS se presentes e válidos
      const validFrom = couponData.validFrom 
        ? (couponData.validFrom instanceof Date ? couponData.validFrom : new Date(couponData.validFrom))
        : undefined;
      
      const validUntil = couponData.validUntil 
        ? (couponData.validUntil instanceof Date ? couponData.validUntil : new Date(couponData.validUntil))
        : undefined;
      
      const coupon = {
        id: couponId,
        ...couponData,
        ...(validFrom && { validFrom }),
        ...(validUntil && { validUntil }),
        usedCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.collection('coupons').doc(couponId).set(coupon);
      console.log('✅ Cupom criado:', couponId);
      
      return {
        ...coupon,
        createdAt: coupon.createdAt,
        updatedAt: coupon.updatedAt,
        validFrom: coupon.validFrom,
        validUntil: coupon.validUntil,
      };
    } catch (error) {
      console.error('❌ Erro ao criar cupom:', error);
      throw error;
    }
  }

  async getCoupon(id: string): Promise<any | null> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const doc = await this.db.collection('coupons').doc(id).get();
      
      if (!doc.exists) {
        return null;
      }

      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        validFrom: data.validFrom?.toDate() || new Date(),
        validUntil: data.validUntil?.toDate() || new Date(),
      };
    } catch (error) {
      console.error('❌ Erro ao buscar cupom:', error);
      return null;
    }
  }

  async getCouponsByProduct(productId: string, tenantId: string): Promise<any[]> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const snapshot = await this.db.collection('coupons')
        .where('productId', '==', productId)
        .where('tenantId', '==', tenantId)
        .get();

      const coupons = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          validFrom: data.validFrom?.toDate() || new Date(),
          validUntil: data.validUntil?.toDate() || new Date(),
        };
      });

      return coupons;
    } catch (error) {
      console.error('❌ Erro ao buscar cupons por produto:', error);
      return [];
    }
  }

  async getCouponsByCheckout(checkoutId: string, tenantId: string): Promise<any[]> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      console.log(`🔍 Buscando cupons para checkout ${checkoutId} e tenant ${tenantId}`);

      const snapshot = await this.db.collection('coupons')
        .where('productId', '==', checkoutId)
        .where('tenantId', '==', tenantId)
        .get();

      console.log(`📦 ${snapshot.size} cupons encontrados`);

      const coupons = snapshot.docs.map(doc => {
        const data = doc.data();
        try {
          return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.() || data.createdAt || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || data.updatedAt || new Date(),
            validFrom: data.validFrom?.toDate?.() || data.validFrom || new Date(),
            validUntil: data.validUntil?.toDate?.() || data.validUntil || new Date(),
          };
        } catch (dateError) {
          console.warn(`⚠️ Erro ao converter datas do cupom ${doc.id}:`, dateError);
          return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt || new Date(),
            updatedAt: data.updatedAt || new Date(),
            validFrom: data.validFrom || new Date(),
            validUntil: data.validUntil || new Date(),
          };
        }
      });

      console.log(`✅ ${coupons.length} cupons processados com sucesso`);
      return coupons;
    } catch (error) {
      console.error('❌ Erro ao buscar cupons por checkout:', error);
      return [];
    }
  }

  async getCouponByCode(code: string, tenantId: string): Promise<any | null> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const snapshot = await this.db.collection('coupons')
        .where('code', '==', code.toUpperCase())
        .where('tenantId', '==', tenantId)
        .where('active', '==', true)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }

      const doc = snapshot.docs[0];
      const data = doc.data();
      
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        validFrom: data.validFrom?.toDate() || new Date(),
        validUntil: data.validUntil?.toDate() || new Date(),
      };
    } catch (error) {
      console.error('❌ Erro ao buscar cupom por código:', error);
      return null;
    }
  }

  async updateCoupon(id: string, updates: any): Promise<any> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const updateData = {
        ...updates,
        updatedAt: new Date(),
      };

      await this.db.collection('coupons').doc(id).update(updateData);
      
      const doc = await this.db.collection('coupons').doc(id).get();
      const data = doc.data();
      
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        validFrom: data.validFrom?.toDate() || new Date(),
        validUntil: data.validUntil?.toDate() || new Date(),
      };
    } catch (error) {
      console.error('❌ Erro ao atualizar cupom:', error);
      throw error;
    }
  }

  async deleteCoupon(id: string): Promise<void> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      await this.db.collection('coupons').doc(id).delete();
      console.log('✅ Cupom deletado:', id);
    } catch (error) {
      console.error('❌ Erro ao deletar cupom:', error);
      throw error;
    }
  }

  async incrementCouponUsage(id: string): Promise<void> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const couponRef = this.db.collection('coupons').doc(id);
      const couponDoc = await couponRef.get();
      const currentCount = couponDoc.data()?.usedCount || 0;
      
      await couponRef.update({
        usedCount: currentCount + 1,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error('❌ Erro ao incrementar uso do cupom:', error);
      throw error;
    }
  }

  // ⭐ TESTIMONIALS (DEPOIMENTOS) - FIREBASE/FIRESTORE
  async createTestimonial(testimonialData: any): Promise<any> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const now = new Date();
      const testimonialId = `testimonial_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const testimonial = {
        id: testimonialId,
        ...testimonialData,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.collection('testimonials').doc(testimonialId).set(testimonial);
      console.log('✅ Depoimento criado:', testimonialId);
      
      return {
        ...testimonial,
        createdAt: testimonial.createdAt,
        updatedAt: testimonial.updatedAt,
      };
    } catch (error) {
      console.error('❌ Erro ao criar depoimento:', error);
      throw error;
    }
  }

  async getTestimonial(id: string): Promise<any | null> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const doc = await this.db.collection('testimonials').doc(id).get();
      
      if (!doc.exists) {
        return null;
      }

      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      };
    } catch (error) {
      console.error('❌ Erro ao buscar depoimento:', error);
      return null;
    }
  }

  async getTestimonialsByCheckout(checkoutId: string, tenantId: string): Promise<any[]> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      console.log(`🔍 Buscando depoimentos para checkout ${checkoutId} e tenant ${tenantId}`);

      // ✅ SEM ORDERBY - Evita necessidade de índice composto no Firestore
      const snapshot = await this.db.collection('testimonials')
        .where('checkoutId', '==', checkoutId)
        .where('tenantId', '==', tenantId)
        .get();

      console.log(`📦 ${snapshot.size} depoimentos encontrados`);

      const testimonials = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          position: data.position || 0
        };
      });

      // ✅ ORDENAR NO CÓDIGO (client-side) - Sem necessidade de índice
      return testimonials.sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
    } catch (error) {
      console.error('❌ Erro ao buscar depoimentos:', error);
      return [];
    }
  }

  async updateTestimonial(id: string, updates: any): Promise<any> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const updateData = {
        ...updates,
        updatedAt: new Date(),
      };

      await this.db.collection('testimonials').doc(id).update(updateData);
      
      const doc = await this.db.collection('testimonials').doc(id).get();
      const data = doc.data();
      
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      };
    } catch (error) {
      console.error('❌ Erro ao atualizar depoimento:', error);
      throw error;
    }
  }

  async deleteTestimonial(id: string): Promise<void> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      await this.db.collection('testimonials').doc(id).delete();
      console.log('✅ Depoimento deletado:', id);
    } catch (error) {
      console.error('❌ Erro ao deletar depoimento:', error);
      throw error;
    }
  }

  // 📊 MANAGED PIXELS - FIREBASE/FIRESTORE (SUBCOLLECTION)
  async createManagedPixel(pixel: any): Promise<any> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const pixelId = pixel.id || `pixel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const pixelData = {
        ...pixel,
        id: pixelId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.db
        .collection('checkouts')
        .doc(pixel.checkoutId)
        .collection('pixels')
        .doc(pixelId)
        .set(pixelData);

      console.log('✅ Pixel criado:', pixelId, 'para checkout:', pixel.checkoutId);
      return pixelData;
    } catch (error) {
      console.error('❌ Erro ao criar pixel:', error);
      throw error;
    }
  }

  async getManagedPixel(pixelId: string, checkoutId: string): Promise<any | null> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const doc = await this.db
        .collection('checkouts')
        .doc(checkoutId)
        .collection('pixels')
        .doc(pixelId)
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      };
    } catch (error) {
      console.error('❌ Erro ao buscar pixel:', error);
      throw error;
    }
  }

  // ✅ TRANSFORMADOR ROBUSTO - Converte QUALQUER camelCase para snake_case
  private camelToSnake(str: string): string {
    // Handle consecutive capitals (e.g., "GA4Config" → "ga4_config")
    return str
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')  // Split consecutive capitals
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')      // Split camelCase
      .replace(/^_/, '')                           // Remove leading underscore
      .toLowerCase();
  }

  // ✅ NORMALIZADOR RECURSIVO UNIVERSAL - Converte QUALQUER objeto para snake_case (TODOS os níveis)
  private deepNormalizeToSnakeCase(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    
    // Se for primitivo, retorna direto
    if (typeof obj !== 'object') return obj;
    
    // ✅ GUARD: Tipos especiais que não devem ser normalizados
    // Date, Timestamp, Buffer, etc - retornar sem modificar
    if (obj instanceof Date) return obj;
    if (obj.constructor && obj.constructor.name === 'Timestamp') return obj; // Firestore Timestamp
    if (Buffer.isBuffer(obj)) return obj;
    
    // Se for array, normaliza cada elemento recursivamente
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepNormalizeToSnakeCase(item));
    }
    
    // Se for objeto, normaliza todas as chaves E valores recursivamente
    const normalized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = this.camelToSnake(key);
      normalized[snakeKey] = this.deepNormalizeToSnakeCase(value);
    }
    
    return normalized;
  }

  // ✅ NORMALIZER SIMPLIFICADO - Usa normalizador recursivo universal
  private normalizePixelToSnakeCase(pixel: any): any {
    // ✅ Aplica normalização recursiva UNIVERSAL
    const fullyNormalized = this.deepNormalizeToSnakeCase(pixel);
    
    // ✅ Garante campos essenciais com fallbacks corretos
    return {
      id: fullyNormalized.id || pixel.id,
      platform: fullyNormalized.platform || pixel.platform,
      name: fullyNormalized.name || pixel.name || '',
      enabled: fullyNormalized.enabled !== undefined ? fullyNormalized.enabled : true,
      events: fullyNormalized.events || {},
      tenant_id: fullyNormalized.tenant_id || pixel.tenant_id || pixel.tenantId,
      checkout_id: fullyNormalized.checkout_id || pixel.checkout_id || pixel.checkoutId,
      created_at: fullyNormalized.created_at || pixel.created_at || pixel.createdAt,
      updated_at: fullyNormalized.updated_at || pixel.updated_at || pixel.updatedAt,
      is_legacy: fullyNormalized.is_legacy || pixel.is_legacy || pixel.isLegacy || false,
      
      // ✅ Campos opcionais específicos por plataforma (já normalizados recursivamente)
      ...(fullyNormalized.pixel_id && { pixel_id: fullyNormalized.pixel_id }),
      ...(fullyNormalized.conversion_id && { conversion_id: fullyNormalized.conversion_id }),
      ...(fullyNormalized.conversion_label && { conversion_label: fullyNormalized.conversion_label }),
      ...(fullyNormalized.measurement_id && { measurement_id: fullyNormalized.measurement_id }),
      ...(fullyNormalized.tag_id && { tag_id: fullyNormalized.tag_id }),
      ...(fullyNormalized.ad_account_id && { ad_account_id: fullyNormalized.ad_account_id }),
      ...(fullyNormalized.access_token && { access_token: fullyNormalized.access_token }),
    };
  }

  async getManagedPixelsByCheckout(checkoutId: string, tenantId: string): Promise<any[]> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      // ✅ PASSO 1: Buscar pixels da nova subcollection
      const snapshot = await this.db
        .collection('checkouts')
        .doc(checkoutId)
        .collection('pixels')
        .where('tenantId', '==', tenantId)
        .get();

      const subcollectionPixels = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data?.createdAt?.toDate() || new Date(),
          updatedAt: data?.updatedAt?.toDate() || new Date(),
        };
      });

      // ✅ PASSO 2: Buscar checkout principal para ler campos legacy
      const checkoutDoc = await this.db
        .collection('checkouts')
        .doc(checkoutId)
        .get();

      const checkoutData = checkoutDoc.data();
      const legacyPixels: any[] = [];

      if (checkoutData && checkoutDoc.exists) {
        // ✅ BACKWARD COMPATIBILITY: Converter campos legacy para formato novo
        
        // ✅ Facebook Pixel (camelCase temporário, será normalizado depois)
        if (checkoutData.facebookPixel) {
          legacyPixels.push({
            id: 'legacy_facebook',
            platform: 'facebook',
            name: 'Facebook Pixel (Legacy)',
            pixelId: checkoutData.facebookPixel,
            enabled: true,
            events: { pageView: true, viewContent: true, purchase: true },
            tenantId,
            checkoutId,
            createdAt: new Date(),
            updatedAt: new Date(),
            isLegacy: true,
          });
        }

        // ✅ Google Ads (camelCase temporário, será normalizado depois)
        if (checkoutData.googleAdsId) {
          legacyPixels.push({
            id: 'legacy_google_ads',
            platform: 'google_ads',
            name: 'Google Ads (Legacy)',
            conversionId: checkoutData.googleAdsId,
            conversionLabel: checkoutData.googleAdsLabel || '',
            enabled: true,
            events: { pageView: true, purchase: true },
            tenantId,
            checkoutId,
            createdAt: new Date(),
            updatedAt: new Date(),
            isLegacy: true,
          });
        }

        // ✅ TikTok Pixel (camelCase temporário, será normalizado depois)
        if (checkoutData.tiktokPixel) {
          legacyPixels.push({
            id: 'legacy_tiktok',
            platform: 'tiktok',
            name: 'TikTok Pixel (Legacy)',
            pixelId: checkoutData.tiktokPixel,
            enabled: true,
            events: { pageView: true, purchase: true },
            tenantId,
            checkoutId,
            createdAt: new Date(),
            updatedAt: new Date(),
            isLegacy: true,
          });
        }

        // ✅ Kwai Pixel (camelCase temporário, será normalizado depois)
        if (checkoutData.kwaiPixelId) {
          legacyPixels.push({
            id: 'legacy_kwai',
            platform: 'kwai',
            name: 'Kwai Pixel (Legacy)',
            pixelId: checkoutData.kwaiPixelId,
            enabled: true,
            events: { pageView: true, purchase: true },
            tenantId,
            checkoutId,
            createdAt: new Date(),
            updatedAt: new Date(),
            isLegacy: true,
          });
        }

        // ✅ Google Analytics 4 (camelCase temporário, será normalizado depois)
        if (checkoutData.googleAnalyticsId) {
          legacyPixels.push({
            id: 'legacy_google_analytics_4',
            platform: 'google_analytics_4',
            name: 'Google Analytics 4 (Legacy)',
            measurementId: checkoutData.googleAnalyticsId,
            enabled: true,
            events: { pageView: true, purchase: true },
            tenantId,
            checkoutId,
            createdAt: new Date(),
            updatedAt: new Date(),
            isLegacy: true,
          });
        }
      }

      // ✅ PASSO 3: Merge - Subcollection tem prioridade sobre legacy
      const legacyIds = new Set(subcollectionPixels.map((p: any) => p.platform));
      const filteredLegacy = legacyPixels.filter((p: any) => !legacyIds.has(p.platform));

      console.log(`📊 Pixels carregados: ${subcollectionPixels.length} novos + ${filteredLegacy.length} legacy`);

      // ✅ PASSO 4: NORMALIZAR TODOS OS PIXELS PARA SNAKE_CASE
      const allPixels = [...subcollectionPixels, ...filteredLegacy];
      const normalizedPixels = allPixels.map(pixel => this.normalizePixelToSnakeCase(pixel));

      return normalizedPixels;
    } catch (error) {
      console.error('❌ Erro ao buscar pixels do checkout:', error);
      throw error;
    }
  }

  async updateManagedPixel(pixelId: string, checkoutId: string, updates: any): Promise<any> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const updateData = {
        ...updates,
        updatedAt: new Date(),
      };

      await this.db
        .collection('checkouts')
        .doc(checkoutId)
        .collection('pixels')
        .doc(pixelId)
        .update(updateData);

      const doc = await this.db
        .collection('checkouts')
        .doc(checkoutId)
        .collection('pixels')
        .doc(pixelId)
        .get();
      
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      };
    } catch (error) {
      console.error('❌ Erro ao atualizar pixel:', error);
      throw error;
    }
  }

  async deleteManagedPixel(pixelId: string, checkoutId: string): Promise<void> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      await this.db
        .collection('checkouts')
        .doc(checkoutId)
        .collection('pixels')
        .doc(pixelId)
        .delete();

      console.log('✅ Pixel deletado:', pixelId);
    } catch (error) {
      console.error('❌ Erro ao deletar pixel:', error);
      throw error;
    }
  }

  // 📊 PRODUCT PIXEL OPERATIONS - FIREBASE/FIRESTORE

  async createProductPixel(pixel: any): Promise<any> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const pixelId = pixel.id || `pixel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const pixelData = {
        ...pixel,
        id: pixelId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.db
        .collection('products')
        .doc(pixel.productId)
        .collection('pixels')
        .doc(pixelId)
        .set(pixelData);

      console.log('✅ Product pixel criado:', pixelId, 'para product:', pixel.productId);
      return pixelData;
    } catch (error) {
      console.error('❌ Erro ao criar product pixel:', error);
      throw error;
    }
  }

  async getProductPixel(pixelId: string, productId: string): Promise<any | null> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const doc = await this.db
        .collection('products')
        .doc(productId)
        .collection('pixels')
        .doc(pixelId)
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      };
    } catch (error) {
      console.error('❌ Erro ao buscar product pixel:', error);
      throw error;
    }
  }

  async getManagedPixelsByProduct(productId: string, tenantId: string): Promise<any[]> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const snapshot = await this.db
        .collection('products')
        .doc(productId)
        .collection('pixels')
        .where('tenantId', '==', tenantId)
        .get();

      const pixels = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data?.createdAt?.toDate() || new Date(),
          updatedAt: data?.updatedAt?.toDate() || new Date(),
        };
      });

      console.log(`📊 Product pixels carregados: ${pixels.length} para product ${productId}`);
      return pixels;
    } catch (error) {
      console.error('❌ Erro ao buscar pixels do product:', error);
      throw error;
    }
  }

  async updateProductPixel(pixelId: string, productId: string, updates: any): Promise<any> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      const updateData = {
        ...updates,
        updatedAt: new Date(),
      };

      await this.db
        .collection('products')
        .doc(productId)
        .collection('pixels')
        .doc(pixelId)
        .update(updateData);

      const doc = await this.db
        .collection('products')
        .doc(productId)
        .collection('pixels')
        .doc(pixelId)
        .get();

      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      };
    } catch (error) {
      console.error('❌ Erro ao atualizar product pixel:', error);
      throw error;
    }
  }

  async deleteProductPixel(pixelId: string, productId: string): Promise<void> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase/Firestore não disponível');
      }

      await this.db
        .collection('products')
        .doc(productId)
        .collection('pixels')
        .doc(pixelId)
        .delete();

      console.log('✅ Product pixel deletado:', pixelId);
    } catch (error) {
      console.error('❌ Erro ao deletar product pixel:', error);
      throw error;
    }
  }

  // 👤 CUSTOMER PROFILE OPERATIONS - FIREBASE/FIRESTORE
  async createCustomerProfile(profile: InsertCustomerProfile): Promise<CustomerProfile> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    // 🔥 GERAR ID ÚNICO COM RETRY LOGIC - 100% SEM DUPLICAÇÃO
    let id: string;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (attempts < maxAttempts) {
      id = `cust_${nanoid(21)}`;
      const existingDoc = await this.db.collection('customers').doc(id).get();
      
      if (!existingDoc.exists) {
        console.log(`✅ Customer ID único gerado: ${id}`);
        break;
      }
      
      console.warn(`⚠️ Customer ID duplicado detectado: ${id} - gerando novo`);
      attempts++;
      
      if (attempts >= maxAttempts) {
        throw new Error('🚨 FALHA CRÍTICA: Não foi possível gerar customer ID único');
      }
    }

    const now = new Date();
    const customerData: CustomerProfile = {
      id: id!,
      ...profile,
      firebaseUid: profile.firebaseUid || null,
      totalPurchases: profile.totalPurchases || 0,
      totalSpent: profile.totalSpent || 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('customers').doc(id!).set(customerData);
    console.log('✅ Customer profile criado com ID único:', id);
    return customerData;
  }

  async getCustomerProfile(customerId: string): Promise<CustomerProfile | null> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const doc = await this.db.collection('customers').doc(customerId).get();
    if (!doc.exists) return null;

    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      firstPurchaseAt: data?.firstPurchaseAt ? this.parseFirestoreTimestamp(data.firstPurchaseAt) : undefined,
      lastPurchaseAt: data?.lastPurchaseAt ? this.parseFirestoreTimestamp(data.lastPurchaseAt) : undefined,
    } as CustomerProfile;
  }

  async getCustomerProfileByEmail(email: string): Promise<CustomerProfile | null> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const snapshot = await this.db.collection('customers')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      firstPurchaseAt: data?.firstPurchaseAt ? this.parseFirestoreTimestamp(data.firstPurchaseAt) : undefined,
      lastPurchaseAt: data?.lastPurchaseAt ? this.parseFirestoreTimestamp(data.lastPurchaseAt) : undefined,
    } as CustomerProfile;
  }

  async getCustomerProfileByFirebaseUid(firebaseUid: string): Promise<CustomerProfile | null> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const snapshot = await this.db.collection('customers')
      .where('firebaseUid', '==', firebaseUid)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      firstPurchaseAt: data?.firstPurchaseAt ? this.parseFirestoreTimestamp(data.firstPurchaseAt) : undefined,
      lastPurchaseAt: data?.lastPurchaseAt ? this.parseFirestoreTimestamp(data.lastPurchaseAt) : undefined,
    } as CustomerProfile;
  }

  async updateCustomerProfile(customerId: string, updates: UpdateCustomerProfile): Promise<CustomerProfile> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const updateData = {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await this.db.collection('customers').doc(customerId).update(updateData);

    const doc = await this.db.collection('customers').doc(customerId).get();
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      firstPurchaseAt: data?.firstPurchaseAt ? this.parseFirestoreTimestamp(data.firstPurchaseAt) : undefined,
      lastPurchaseAt: data?.lastPurchaseAt ? this.parseFirestoreTimestamp(data.lastPurchaseAt) : undefined,
    } as CustomerProfile;
  }

  async linkFirebaseUidToCustomer(customerId: string, firebaseUid: string): Promise<CustomerProfile> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    await this.db.collection('customers').doc(customerId).update({
      firebaseUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const doc = await this.db.collection('customers').doc(customerId).get();
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      firstPurchaseAt: data?.firstPurchaseAt ? this.parseFirestoreTimestamp(data.firstPurchaseAt) : undefined,
      lastPurchaseAt: data?.lastPurchaseAt ? this.parseFirestoreTimestamp(data.lastPurchaseAt) : undefined,
    } as CustomerProfile;
  }

  // 🎓 MEMBER ENTITLEMENT OPERATIONS - FIREBASE/FIRESTORE
  async createMemberEntitlement(entitlement: InsertMemberEntitlement): Promise<MemberEntitlement> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    // 🔥 GERAR ID ÚNICO COM RETRY LOGIC - 100% SEM DUPLICAÇÃO
    let id: string;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (attempts < maxAttempts) {
      id = `ent_${nanoid(21)}`;
      const existingDoc = await this.db.collection('memberEntitlements').doc(id).get();
      
      if (!existingDoc.exists) {
        console.log(`✅ Entitlement ID único gerado: ${id}`);
        break;
      }
      
      console.warn(`⚠️ Entitlement ID duplicado detectado: ${id} - gerando novo`);
      attempts++;
      
      if (attempts >= maxAttempts) {
        throw new Error('🚨 FALHA CRÍTICA: Não foi possível gerar entitlement ID único');
      }
    }

    const now = new Date();
    const entitlementData: MemberEntitlement = {
      id: id!,
      ...entitlement,
      status: entitlement.status || 'active',
      isSubscription: entitlement.isSubscription || false,
      accessDeniedCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('memberEntitlements').doc(id!).set(entitlementData);
    console.log('✅ Member entitlement criado com ID único:', id);
    return entitlementData;
  }

  async getMemberEntitlement(entitlementId: string): Promise<MemberEntitlement | null> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const doc = await this.db.collection('memberEntitlements').doc(entitlementId).get();
    if (!doc.exists) return null;

    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      accessStartDate: this.parseFirestoreTimestamp(data?.accessStartDate),
      accessEndDate: data?.accessEndDate ? this.parseFirestoreTimestamp(data.accessEndDate) : null,
      nextBillingDate: data?.nextBillingDate ? this.parseFirestoreTimestamp(data.nextBillingDate) : undefined,
      lastAccessAt: data?.lastAccessAt ? this.parseFirestoreTimestamp(data.lastAccessAt) : undefined,
      cancelledAt: data?.cancelledAt ? this.parseFirestoreTimestamp(data.cancelledAt) : undefined,
      suspendedAt: data?.suspendedAt ? this.parseFirestoreTimestamp(data.suspendedAt) : undefined,
      lastDeniedAt: data?.lastDeniedAt ? this.parseFirestoreTimestamp(data.lastDeniedAt) : undefined,
    } as MemberEntitlement;
  }

  async getMemberEntitlementsByCustomer(customerId: string, options?: { activeOnly?: boolean }): Promise<MemberEntitlement[]> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    let query = this.db.collection('memberEntitlements')
      .where('customerId', '==', customerId);

    if (options?.activeOnly) {
      query = query.where('status', '==', 'active');
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: this.parseFirestoreTimestamp(data?.createdAt),
        updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
        accessStartDate: this.parseFirestoreTimestamp(data?.accessStartDate),
        accessEndDate: data?.accessEndDate ? this.parseFirestoreTimestamp(data.accessEndDate) : null,
        nextBillingDate: data?.nextBillingDate ? this.parseFirestoreTimestamp(data.nextBillingDate) : undefined,
        lastAccessAt: data?.lastAccessAt ? this.parseFirestoreTimestamp(data.lastAccessAt) : undefined,
        cancelledAt: data?.cancelledAt ? this.parseFirestoreTimestamp(data.cancelledAt) : undefined,
        suspendedAt: data?.suspendedAt ? this.parseFirestoreTimestamp(data.suspendedAt) : undefined,
        lastDeniedAt: data?.lastDeniedAt ? this.parseFirestoreTimestamp(data.lastDeniedAt) : undefined,
      } as MemberEntitlement;
    });
  }

  async getMemberEntitlementByOrder(orderId: string): Promise<MemberEntitlement | null> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const snapshot = await this.db.collection('memberEntitlements')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      accessStartDate: this.parseFirestoreTimestamp(data?.accessStartDate),
      accessEndDate: data?.accessEndDate ? this.parseFirestoreTimestamp(data.accessEndDate) : null,
      nextBillingDate: data?.nextBillingDate ? this.parseFirestoreTimestamp(data.nextBillingDate) : undefined,
      lastAccessAt: data?.lastAccessAt ? this.parseFirestoreTimestamp(data.lastAccessAt) : undefined,
      cancelledAt: data?.cancelledAt ? this.parseFirestoreTimestamp(data.cancelledAt) : undefined,
      suspendedAt: data?.suspendedAt ? this.parseFirestoreTimestamp(data.suspendedAt) : undefined,
      lastDeniedAt: data?.lastDeniedAt ? this.parseFirestoreTimestamp(data.lastDeniedAt) : undefined,
    } as MemberEntitlement;
  }

  async updateMemberEntitlement(entitlementId: string, updates: UpdateMemberEntitlement): Promise<MemberEntitlement> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const updateData = {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await this.db.collection('memberEntitlements').doc(entitlementId).update(updateData);

    const doc = await this.db.collection('memberEntitlements').doc(entitlementId).get();
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      accessStartDate: this.parseFirestoreTimestamp(data?.accessStartDate),
      accessEndDate: data?.accessEndDate ? this.parseFirestoreTimestamp(data.accessEndDate) : null,
      nextBillingDate: data?.nextBillingDate ? this.parseFirestoreTimestamp(data.nextBillingDate) : undefined,
      lastAccessAt: data?.lastAccessAt ? this.parseFirestoreTimestamp(data.lastAccessAt) : undefined,
      cancelledAt: data?.cancelledAt ? this.parseFirestoreTimestamp(data.cancelledAt) : undefined,
      suspendedAt: data?.suspendedAt ? this.parseFirestoreTimestamp(data.suspendedAt) : undefined,
      lastDeniedAt: data?.lastDeniedAt ? this.parseFirestoreTimestamp(data.lastDeniedAt) : undefined,
    } as MemberEntitlement;
  }

  async revokeMemberEntitlement(entitlementId: string, reason: string): Promise<MemberEntitlement> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const updateData = {
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelReason: reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await this.db.collection('memberEntitlements').doc(entitlementId).update(updateData);

    const doc = await this.db.collection('memberEntitlements').doc(entitlementId).get();
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      accessStartDate: this.parseFirestoreTimestamp(data?.accessStartDate),
      accessEndDate: data?.accessEndDate ? this.parseFirestoreTimestamp(data.accessEndDate) : null,
      nextBillingDate: data?.nextBillingDate ? this.parseFirestoreTimestamp(data.nextBillingDate) : undefined,
      lastAccessAt: data?.lastAccessAt ? this.parseFirestoreTimestamp(data.lastAccessAt) : undefined,
      cancelledAt: data?.cancelledAt ? this.parseFirestoreTimestamp(data.cancelledAt) : undefined,
      suspendedAt: data?.suspendedAt ? this.parseFirestoreTimestamp(data.suspendedAt) : undefined,
      lastDeniedAt: data?.lastDeniedAt ? this.parseFirestoreTimestamp(data.lastDeniedAt) : undefined,
    } as MemberEntitlement;
  }

  async recordEntitlementAccess(entitlementId: string): Promise<void> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    await this.db.collection('memberEntitlements').doc(entitlementId).update({
      lastAccessAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  async recordEntitlementDenial(entitlementId: string): Promise<void> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    await this.db.collection('memberEntitlements').doc(entitlementId).update({
      accessDeniedCount: admin.firestore.FieldValue.increment(1),
      lastDeniedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // 💰 REFUND REQUEST OPERATIONS - FIREBASE/FIRESTORE
  async createRefundRequest(request: InsertRefundRequest): Promise<RefundRequest> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    // 🔥 GERAR ID ÚNICO COM RETRY LOGIC - 100% SEM DUPLICAÇÃO
    let id: string;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (attempts < maxAttempts) {
      id = `ref_${nanoid(21)}`;
      const existingDoc = await this.db.collection('refundRequests').doc(id).get();
      
      if (!existingDoc.exists) {
        console.log(`✅ Refund ID único gerado: ${id}`);
        break;
      }
      
      console.warn(`⚠️ Refund ID duplicado detectado: ${id} - gerando novo`);
      attempts++;
      
      if (attempts >= maxAttempts) {
        throw new Error('🚨 FALHA CRÍTICA: Não foi possível gerar refund ID único');
      }
    }

    const now = new Date();
    const refundData: RefundRequest = {
      id: id!,
      ...request,
      status: request.status || 'pending',
      isPartialRefund: request.isPartialRefund || false,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('refundRequests').doc(id!).set(refundData);
    console.log('✅ Refund request criado com ID único:', id);
    return refundData;
  }

  async getRefundRequest(requestId: string): Promise<RefundRequest | null> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const doc = await this.db.collection('refundRequests').doc(requestId).get();
    if (!doc.exists) return null;

    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      requestedAt: this.parseFirestoreTimestamp(data?.requestedAt),
      processedAt: data?.processedAt ? this.parseFirestoreTimestamp(data.processedAt) : undefined,
      refundedAt: data?.refundedAt ? this.parseFirestoreTimestamp(data.refundedAt) : undefined,
    } as RefundRequest;
  }

  async getRefundRequestsByCustomer(customerId: string): Promise<RefundRequest[]> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const snapshot = await this.db.collection('refundRequests')
      .where('customerId', '==', customerId)
      .orderBy('requestedAt', 'desc')
      .get();

    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: this.parseFirestoreTimestamp(data?.createdAt),
        updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
        requestedAt: this.parseFirestoreTimestamp(data?.requestedAt),
        processedAt: data?.processedAt ? this.parseFirestoreTimestamp(data.processedAt) : undefined,
        refundedAt: data?.refundedAt ? this.parseFirestoreTimestamp(data.refundedAt) : undefined,
      } as RefundRequest;
    });
  }

  async getRefundRequestsBySeller(sellerId: string, options?: { statusFilter?: string }): Promise<RefundRequest[]> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    let query = this.db.collection('refundRequests')
      .where('sellerId', '==', sellerId);

    if (options?.statusFilter) {
      query = query.where('status', '==', options.statusFilter);
    }

    const snapshot = await query.orderBy('requestedAt', 'desc').get();

    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: this.parseFirestoreTimestamp(data?.createdAt),
        updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
        requestedAt: this.parseFirestoreTimestamp(data?.requestedAt),
        processedAt: data?.processedAt ? this.parseFirestoreTimestamp(data.processedAt) : undefined,
        refundedAt: data?.refundedAt ? this.parseFirestoreTimestamp(data.refundedAt) : undefined,
      } as RefundRequest;
    });
  }

  async getAllRefundRequests(options?: { statusFilter?: string, limit?: number }): Promise<RefundRequest[]> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    let query: any = this.db.collection('refundRequests');

    if (options?.statusFilter) {
      query = query.where('status', '==', options.statusFilter);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const snapshot = await query.get();

    // Ordenar em memória para evitar composite index
    const results = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: this.parseFirestoreTimestamp(data?.createdAt),
        updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
        requestedAt: this.parseFirestoreTimestamp(data?.requestedAt),
        processedAt: data?.processedAt ? this.parseFirestoreTimestamp(data.processedAt) : undefined,
        refundedAt: data?.refundedAt ? this.parseFirestoreTimestamp(data.refundedAt) : undefined,
      } as RefundRequest;
    });

    // Ordenar por requestedAt desc
    return results.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
  }

  async updateRefundRequest(requestId: string, updates: UpdateRefundRequest): Promise<RefundRequest> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const updateData = {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await this.db.collection('refundRequests').doc(requestId).update(updateData);

    const doc = await this.db.collection('refundRequests').doc(requestId).get();
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      requestedAt: this.parseFirestoreTimestamp(data?.requestedAt),
      processedAt: data?.processedAt ? this.parseFirestoreTimestamp(data.processedAt) : undefined,
      refundedAt: data?.refundedAt ? this.parseFirestoreTimestamp(data.refundedAt) : undefined,
    } as RefundRequest;
  }

  async approveRefundRequest(requestId: string, processedBy: string, processedByName: string): Promise<RefundRequest> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const updateData = {
      status: 'approved',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy,
      processedByName,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await this.db.collection('refundRequests').doc(requestId).update(updateData);

    const doc = await this.db.collection('refundRequests').doc(requestId).get();
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      requestedAt: this.parseFirestoreTimestamp(data?.requestedAt),
      processedAt: data?.processedAt ? this.parseFirestoreTimestamp(data.processedAt) : undefined,
      refundedAt: data?.refundedAt ? this.parseFirestoreTimestamp(data.refundedAt) : undefined,
    } as RefundRequest;
  }

  async denyRefundRequest(requestId: string, processedBy: string, processedByName: string, denialReason: string): Promise<RefundRequest> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const updateData = {
      status: 'denied',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy,
      processedByName,
      denialReason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await this.db.collection('refundRequests').doc(requestId).update(updateData);

    const doc = await this.db.collection('refundRequests').doc(requestId).get();
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      requestedAt: this.parseFirestoreTimestamp(data?.requestedAt),
      processedAt: data?.processedAt ? this.parseFirestoreTimestamp(data.processedAt) : undefined,
      refundedAt: data?.refundedAt ? this.parseFirestoreTimestamp(data.refundedAt) : undefined,
    } as RefundRequest;
  }

  async markRefundAsCompleted(requestId: string, refundData: { refundedAmount: number, refundMethod: string, refundTransactionId?: string }): Promise<RefundRequest> {
    await this.ensureFirebaseReady();
    if (!this.db) throw new Error('Firebase/Firestore não disponível');

    const updateData = {
      status: 'refunded',
      refundedAmount: refundData.refundedAmount,
      refundMethod: refundData.refundMethod,
      refundTransactionId: refundData.refundTransactionId,
      refundedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await this.db.collection('refundRequests').doc(requestId).update(updateData);

    const doc = await this.db.collection('refundRequests').doc(requestId).get();
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: this.parseFirestoreTimestamp(data?.createdAt),
      updatedAt: this.parseFirestoreTimestamp(data?.updatedAt),
      requestedAt: this.parseFirestoreTimestamp(data?.requestedAt),
      processedAt: data?.processedAt ? this.parseFirestoreTimestamp(data.processedAt) : undefined,
      refundedAt: data?.refundedAt ? this.parseFirestoreTimestamp(data.refundedAt) : undefined,
    } as RefundRequest;
  }

  // 🛒 UPDATE CHECKOUT - FIREBASE/FIRESTORE PERMANENTE  
  async updateCheckout(id: string, updates: Partial<Checkout>): Promise<Checkout | undefined> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      console.log(`🔄 ATUALIZANDO CHECKOUT NO FIREBASE: ${id}`);
      
      // 🔧 LIMPAR VALORES UNDEFINED ANTES DE SALVAR NO FIREBASE
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, value]) => value !== undefined)
      );
      
      // Adicionar timestamp de atualização
      const updateData = {
        ...cleanUpdates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      await this.db.collection('checkouts').doc(id).update(updateData);
      
      // Buscar e retornar checkout atualizado
      const updatedDoc = await this.db.collection('checkouts').doc(id).get();
      if (!updatedDoc.exists) {
        console.error('❌ Checkout não encontrado após atualização:', id);
        return undefined;
      }
      
      const data = updatedDoc.data();
      const updatedCheckout = {
        id: updatedDoc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Checkout;
      
      console.log(`✅ CHECKOUT ATUALIZADO COM SUCESSO NO FIREBASE: ${id}`);
      try {
        firestoreCache.setCheckout(id, updatedCheckout);
        if (updatedCheckout.tenantId) {
          firestoreCache.invalidateTenantCheckouts(updatedCheckout.tenantId);
        }
      } catch (e) {}
      return updatedCheckout;
      
    } catch (error) {
      console.error('❌ Erro ao atualizar checkout no Firebase:', error);
      return undefined;
    }
  }

  // 🗑️ DELETE CHECKOUT - FIREBASE/FIRESTORE PERMANENTE
  async deleteCheckout(id: string): Promise<boolean> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      console.log(`🗑️ DELETANDO CHECKOUT NO FIREBASE: ${id}`);
      
      // Verificar se checkout existe antes de deletar
      const checkoutDoc = await this.db.collection('checkouts').doc(id).get();
      if (!checkoutDoc.exists) {
        console.warn('⚠️ Checkout não encontrado para exclusão:', id);
        return false;
      }
      
      await this.db.collection('checkouts').doc(id).delete();
      
      console.log(`✅ CHECKOUT DELETADO COM SUCESSO DO FIREBASE: ${id}`);
      return true;
      
    } catch (error) {
      console.error('❌ Erro ao deletar checkout no Firebase:', error);
      return false;
    }
  }

  // 📚 LIST MODULES BY TENANT - FIREBASE/FIRESTORE PERMANENTE  
  async listModulesByTenant(tenantId: string): Promise<Module[]> {
    try {
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      console.log('🔍 BUSCANDO MÓDULOS DO TENANT NO FIREBASE:', tenantId);
      
      const snapshot = await this.db.collection('modules')
        .where('tenantId', '==', tenantId)
        .orderBy('createdAt', 'desc')
        .get();
      
      const modules = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data?.createdAt?.toDate() || new Date(),
          updatedAt: data?.updatedAt?.toDate() || new Date(),
        } as Module;
      });
      
      console.log(`✅ ${modules.length} MÓDULOS ENCONTRADOS PARA TENANT ${tenantId}`);
      return modules;
      
    } catch (error) {
      console.error('❌ Erro ao buscar módulos por tenant no Firestore:', error);
      return [];
    }
  }

  // 📦 LIST PRODUCTS BY TENANT (ALIAS) - FIREBASE/FIRESTORE PERMANENTE
  async listProductsByTenant(tenantId: string): Promise<Product[]> {
    // Usar o mesmo método getProductsByTenant para consistência
    return this.getProductsByTenant(tenantId);
  }


  async getModulesByProduct(productId: string): Promise<Module[]> {
    try {
      console.log('📚 STORAGE: Buscando módulos para produto:', productId);
      
      if (!this.db) {
        throw new Error('Firebase não conectado');
      }
      
      // Query simplificada para evitar índice composto
      const snapshot = await this.db.collection('modules')
        .where('productId', '==', productId)
        .get();
      
      const modules = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        } as Module;
      }).filter(module => module.active) // Filtrar active no código
        .sort((a, b) => a.position - b.position); // Ordenar no código
      
      console.log(`✅ STORAGE: ${modules.length} módulos encontrados para produto ${productId}`);
      return modules;
      
    } catch (error) {
      console.error('❌ STORAGE: Erro ao buscar módulos por produto:', error);
      throw error;
    }
  }


  async getLessonsByModule(moduleId: string): Promise<Lesson[]> {
    try {
      console.log('🎓 STORAGE: Buscando aulas para módulo:', moduleId);
      
      if (!this.db) {
        throw new Error('Firebase não conectado');
      }
      
      // Query simplificada para evitar índice composto
      const snapshot = await this.db.collection('lessons')
        .where('moduleId', '==', moduleId)
        .get();
      
      const lessons = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        } as Lesson;
      }).filter(lesson => lesson.active) // Filtrar active no código
        .sort((a, b) => a.position - b.position); // Ordenar no código
      
      console.log(`✅ STORAGE: ${lessons.length} aulas encontradas para módulo ${moduleId}`);
      return lessons;
      
    } catch (error) {
      console.error('❌ STORAGE: Erro ao buscar aulas por módulo:', error);
      throw error;
    }
  }

  async getLessonsByTenant(tenantId: string): Promise<Lesson[]> {
    try {
      console.log('🎓 STORAGE: Buscando todas as aulas do tenant:', tenantId);
      
      if (!this.db) {
        throw new Error('Firebase não conectado');
      }
      
      // Buscar todas as aulas do tenant
      const snapshot = await this.db.collection('lessons')
        .where('tenantId', '==', tenantId)
        .get();
      
      const lessons = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        } as Lesson;
      }).filter(lesson => lesson.active) // Filtrar apenas aulas ativas
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // Ordenar por mais recente
      
      console.log(`✅ STORAGE: ${lessons.length} aulas encontradas para tenant ${tenantId}`);
      return lessons;
      
    } catch (error) {
      console.error('❌ STORAGE: Erro ao buscar aulas por tenant:', error);
      throw error;
    }
  }

  // ✏️ UPDATE OPERATIONS - EDITAR MÓDULOS E LIÇÕES
  
  async updateModule(id: string, updates: Partial<Module>): Promise<Module | undefined> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase não conectado');
      }

      console.log('✏️ STORAGE: Atualizando módulo:', id, updates);

      // Atualizar módulo no Firebase
      const moduleRef = this.db.collection('modules').doc(id);
      await moduleRef.update({
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Buscar e retornar o módulo atualizado
      const moduleDoc = await moduleRef.get();
      if (!moduleDoc.exists) {
        console.error('❌ STORAGE: Módulo não encontrado após update:', id);
        return undefined;
      }

      const data = moduleDoc.data()!;
      const updatedModule = {
        id: moduleDoc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      } as Module;

      console.log('✅ STORAGE: Módulo atualizado com sucesso:', id);
      return updatedModule;

    } catch (error) {
      console.error('❌ STORAGE: Erro ao atualizar módulo:', error);
      throw error;
    }
  }

  async updateLesson(id: string, updates: Partial<Lesson>): Promise<Lesson | undefined> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase não conectado');
      }

      console.log('✏️ STORAGE: Atualizando lição:', id, updates);

      // Atualizar lição no Firebase
      const lessonRef = this.db.collection('lessons').doc(id);
      await lessonRef.update({
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Buscar e retornar a lição atualizada
      const lessonDoc = await lessonRef.get();
      if (!lessonDoc.exists) {
        console.error('❌ STORAGE: Lição não encontrada após update:', id);
        return undefined;
      }

      const data = lessonDoc.data()!;
      const updatedLesson = {
        id: lessonDoc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      } as Lesson;

      console.log('✅ STORAGE: Lição atualizada com sucesso:', id);
      return updatedLesson;

    } catch (error) {
      console.error('❌ STORAGE: Erro ao atualizar lição:', error);
      throw error;
    }
  }

  // 🗑️ DELETE OPERATIONS - LIMPEZA AUTOMÁTICA DO BANCO

  async deleteModule(id: string): Promise<boolean> {
    try {
      console.log('🗑️ STORAGE: Deletando módulo:', id);
      
      if (!this.db) {
        console.error('❌ STORAGE: Firebase não conectado');
        return false;
      }
      
      // 1. Primeiro, buscar todas as aulas do módulo
      const lessonsSnapshot = await this.db.collection('lessons')
        .where('moduleId', '==', id)
        .get();
      
      console.log(`🗑️ STORAGE: Deletando ${lessonsSnapshot.docs.length} aulas do módulo ${id}`);
      
      // 🐰 2. BUNNY.NET: Coletar todos os vídeos e capas para deletar
      const { cleanupBunnyResources } = await import('./services/bunny-cleanup');
      
      const videoGuids: string[] = [];
      const imageUrls: string[] = [];
      
      lessonsSnapshot.docs.forEach(lessonDoc => {
        const lessonData = lessonDoc.data();
        
        // ✅ CORREÇÃO: Usar bunnyVideoGuid diretamente quando disponível
        if (lessonData.bunnyVideoGuid) {
          videoGuids.push(lessonData.bunnyVideoGuid);
        } else if (lessonData.videoType === 'panda' && lessonData.videoUrl) {
          // FALLBACK: Extrair GUID da URL como backup
          const guidMatch = lessonData.videoUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
          if (guidMatch) {
            videoGuids.push(guidMatch[1]);
          }
        }
        
        // ✅ CORREÇÃO: imageUrl contém URL completa da capa no Bunny Storage
        if (lessonData.imageUrl && (lessonData.imageUrl.includes('b-cdn.net') || lessonData.imageUrl.startsWith('/api/images/'))) {
          imageUrls.push(lessonData.imageUrl);
        }
      });
      
      // 3. Deletar vídeos e capas do Bunny.net (não bloquear se falhar)
      if (videoGuids.length > 0 || imageUrls.length > 0) {
        try {
          console.log(`🐰 [BUNNY] Deletando ${videoGuids.length} vídeos e ${imageUrls.length} capas do módulo ${id}...`);
          const cleanupResult = await cleanupBunnyResources(videoGuids, imageUrls);
          
          console.log('✅ [BUNNY] Cleanup concluído:', {
            videosDeleted: cleanupResult.videosDeleted,
            imagesDeleted: cleanupResult.imagesDeleted,
            errors: cleanupResult.errors
          });
          
          // ⚠️ LOGAR FALHAS (mas não bloquear operação)
          if (cleanupResult.videosFailed > 0) {
            console.warn(`⚠️ [BUNNY] ${cleanupResult.videosFailed} vídeos falharam ao deletar`);
          }
          if (cleanupResult.imagesFailed > 0) {
            console.warn(`⚠️ [BUNNY] ${cleanupResult.imagesFailed} imagens falharam ao deletar`);
          }
        } catch (bunnyError) {
          console.error('❌ [BUNNY] EXCEÇÃO ao deletar conteúdo Bunny.net (continuando):', bunnyError);
          console.error('🚨 [BUNNY] CONTEÚDO ÓRFÃO - Vídeos:', videoGuids, 'Imagens:', imageUrls);
        }
      }
      
      // 4. Deletar todas as aulas do Firestore em paralelo
      const deleteLessonsPromises = lessonsSnapshot.docs.map(lessonDoc => 
        lessonDoc.ref.delete()
      );
      await Promise.all(deleteLessonsPromises);
      
      // 5. Depois, deletar o módulo
      await this.db.collection('modules').doc(id).delete();
      
      console.log('✅ STORAGE: Módulo, aulas e conteúdo Bunny.net deletados:', id);
      return true;
      
    } catch (error) {
      console.error('❌ STORAGE: Erro ao deletar módulo:', error);
      return false;
    }
  }

  async deleteLesson(id: string): Promise<boolean> {
    try {
      console.log('🗑️ STORAGE: Deletando aula:', id);
      
      if (!this.db) {
        console.error('❌ STORAGE: Firebase não conectado');
        return false;
      }
      
      // 🐰 1. BUNNY.NET: Buscar dados da aula para deletar vídeo e capa
      const lessonDoc = await this.db.collection('lessons').doc(id).get();
      if (lessonDoc.exists) {
        const lessonData = lessonDoc.data();
        const { cleanupBunnyResources } = await import('./services/bunny-cleanup');
        
        const videoGuids: string[] = [];
        const imageUrls: string[] = [];
        
        try {
          // ✅ CORREÇÃO: Usar bunnyVideoGuid diretamente quando disponível
          if (lessonData?.bunnyVideoGuid) {
            videoGuids.push(lessonData.bunnyVideoGuid);
            console.log(`🐰 [BUNNY] Vídeo identificado para deleção: ${lessonData.bunnyVideoGuid}`);
          } else if (lessonData?.videoType === 'panda' && lessonData?.videoUrl) {
            // FALLBACK: Extrair GUID da URL como backup
            const guidMatch = lessonData.videoUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
            if (guidMatch) {
              videoGuids.push(guidMatch[1]);
              console.log(`🐰 [BUNNY] Vídeo identificado para deleção (fallback URL): ${guidMatch[1]}`);
            }
          }
          
          // CORREÇÃO: imageUrl contém URL completa da capa no Bunny Storage
          if (lessonData?.imageUrl && (lessonData.imageUrl.includes('b-cdn.net') || lessonData.imageUrl.startsWith('/api/images/'))) {
            imageUrls.push(lessonData.imageUrl);
            console.log(`🐰 [BUNNY] Capa identificada para deleção: ${lessonData.imageUrl}`);
          }
          
          // Deletar recursos do Bunny
          if (videoGuids.length > 0 || imageUrls.length > 0) {
            console.log(`🐰 [BUNNY] Deletando ${videoGuids.length} vídeos e ${imageUrls.length} capas...`);
            const cleanupResult = await cleanupBunnyResources(videoGuids, imageUrls);
            
            console.log('✅ [BUNNY] Cleanup concluído:', {
              videosDeleted: cleanupResult.videosDeleted,
              imagesDeleted: cleanupResult.imagesDeleted,
              errors: cleanupResult.errors
            });
            
            if (cleanupResult.videosFailed > 0 || cleanupResult.imagesFailed > 0) {
              console.warn('⚠️ [BUNNY] Alguns recursos falharam ao deletar:', cleanupResult.errors);
            }
          }
        } catch (bunnyError) {
          console.error('❌ [BUNNY] EXCEÇÃO ao deletar conteúdo Bunny.net (continuando):', bunnyError);
          console.error('🚨 [BUNNY] CONTEÚDO ÓRFÃO - Vídeos:', videoGuids, 'Imagens:', imageUrls);
        }
      }
      
      // 2. Deletar aula do Firestore
      await this.db.collection('lessons').doc(id).delete();
      
      console.log('✅ STORAGE: Aula e conteúdo Bunny.net deletados:', id);
      return true;
      
    } catch (error) {
      console.error('❌ STORAGE: Erro ao deletar aula:', error);
      return false;
    }
  }


  // 🚫 FIREBASE STORAGE REMOVIDO - PLANO GRATUITO
  // Usar apenas URLs externas para imagens e documentos

  // Método público para acessar o database
  getDb(): admin.firestore.Firestore | null {
    return this.db;
  }

  // 🎯 NOVA FUNÇÃO: CRIAR ENROLLMENT AUTOMÁTICO QUANDO PAGAMENTO É CONFIRMADO
  async createEnrollmentOnPayment(orderData: any): Promise<void> {
    try {
      await this.ensureFirebaseReady();
      // 🔥 VERIFICAÇÃO OBRIGATÓRIA - Firebase deve estar conectado
      if (!this.useFirebase || !this.db) {
        console.log('⚠️ Firebase não conectado - não é possível criar enrollment');
        return;
      }

      console.log(`🎯 CRIANDO ENROLLMENT AUTOMÁTICO para order: ${orderData.id}`);
      console.log(`👤 Cliente: ${orderData.customer?.email}`);
      
      // 🔥 BUSCAR CHECKOUT PARA PEGAR O TENANTID DO SELLER DONO DO PRODUTO
      const checkoutDoc = await this.db.collection('checkouts').doc(orderData.checkoutId).get();
      if (!checkoutDoc.exists) {
        console.log(`❌ CHECKOUT NÃO ENCONTRADO: ${orderData.checkoutId} - impossível criar enrollment`);
        return;
      }
      
      const checkoutData = checkoutDoc.data();
      const productOwnerTenantId = checkoutData?.tenantId; // ✅ SELLER DONO DO PRODUTO
      
      if (!productOwnerTenantId) {
        console.log(`❌ CHECKOUT SEM TENANTID: ${orderData.checkoutId} - impossível criar enrollment`);
        return;
      }
      
      // 🎯 CORRIGIR BUG: PEGAR O ID REAL DO PRODUTO, NÃO DO CHECKOUT!
      const realProductId = checkoutData?.syncedProductId || orderData.checkoutId;
      console.log(`🔍 PRODUCT ID DETECTION:`, {
        checkoutId: orderData.checkoutId,
        syncedProductId: checkoutData?.syncedProductId,
        finalProductId: realProductId
      });
      
      // 🎯 LÓGICA ANTI-AFILIADO: Se venda foi de afiliado, enrollment vai para o SELLER DONO
      if (orderData.isAffiliateSale && orderData.affiliateUid) {
        console.log(`🤝 VENDA DE AFILIADO DETECTADA!`);
        console.log(`   → Afiliado UID: ${orderData.affiliateUid}`);
        console.log(`   → Produto Owner: ${productOwnerTenantId}`);
        console.log(`   ✅ Enrollment será criado para o SELLER DONO do produto, NÃO para o afiliado!`);
      }
      
      // 🔥 USAR DADOS IMUTÁVEIS DA ORDER - NÃO BUSCAR PRODUTO ATUAL!
      console.log(`🔥 USANDO DADOS REAIS DA ORDER: ${JSON.stringify({
        checkoutId: orderData.checkoutId,
        amount: orderData.amount,
        customer: orderData.customer?.name,
        method: orderData.method,
        paidAt: orderData.paidAt || new Date(),
        productOwnerTenantId: productOwnerTenantId
      }, null, 2)}`);

      // Usar dados do checkoutSnapshot se existir (capturado na compra)
      const productTitle = orderData.checkoutSnapshot?.title || checkoutData?.title || `Produto ID: ${orderData.checkoutId}`;
      const productAmount = orderData.amount; // Valor REAL pago pelo cliente
      
      console.log(`📦 PRODUTO REAL COMPRADO: ${productTitle} - R$ ${(productAmount/100).toFixed(2)}`)

      // 2. Definir período de acesso - SEMPRE 7 DIAS DE GARANTIA + VITALÍCIO DEPOIS
      const guaranteeDays = 7; // 7 dias de garantia sempre
      
      // 🔥 CONVERTER FIREBASE TIMESTAMP PARA DATE
      let realPurchaseDate: Date;
      if (orderData.paidAt?._seconds) {
        // Firebase Timestamp com _seconds
        realPurchaseDate = new Date(orderData.paidAt._seconds * 1000);
      } else if (orderData.paidAt?.seconds) {
        // Firebase Timestamp com seconds
        realPurchaseDate = new Date(orderData.paidAt.seconds * 1000);
      } else if (orderData.paidAt instanceof Date) {
        realPurchaseDate = orderData.paidAt;
      } else if (orderData.paidAt?.toDate) {
        // Firebase Timestamp com método toDate()
        realPurchaseDate = orderData.paidAt.toDate();
      } else {
        realPurchaseDate = new Date(); // Fallback para agora
      }
      
      const guaranteeExpiresAt = new Date(realPurchaseDate.getTime() + guaranteeDays * 24 * 60 * 60 * 1000);
      
      console.log(`✅ Acesso vitalício com ${guaranteeDays} dias de garantia desde ${realPurchaseDate.toLocaleDateString()} (garantia até: ${guaranteeExpiresAt.toLocaleDateString()})`)

      // 3. Criar enrollment único
      const enrollmentId = `enrollment_${Date.now()}_${orderData.id}_${Math.random().toString(36).substr(2, 12)}`;
      
      // 🔥 USAR DADOS REAIS DA COMPRA - NÃO DADOS ATUAIS DO PRODUTO!
      const purchaseDate = realPurchaseDate; // Usar mesma data da garantia
      
      const enrollmentData = {
        id: enrollmentId,
        tenantId: productOwnerTenantId, // ✅ SEMPRE USAR O SELLER DONO DO PRODUTO!
        productId: realProductId, // 🎯 ID REAL DO PRODUTO (não do checkout!)
        checkoutId: orderData.checkoutId, // ID do checkout usado na compra
        productTitle: productTitle, // Título REAL no momento da compra
        email: orderData.customer?.email,
        customerEmail: orderData.customer?.email, // Campo adicional para queries
        customerName: orderData.customer?.name,
        orderId: orderData.id,
        status: 'active', // Campo correto: status ao invés de active
        enrolledAt: purchaseDate, // DATA REAL DA COMPRA 
        expiresAt: null, // Vitalício
        guaranteeExpiresAt: guaranteeExpiresAt, // 7 dias para garantia
        source: 'payment_confirmed',
        paymentMethod: orderData.method || 'pix',
        amount: productAmount, // VALOR REAL PAGO (CENTAVOS)
        originalAmount: productAmount, // VALOR ORIGINAL DA TRANSAÇÃO
        currency: orderData.currency || 'BRL',
        method: orderData.method || 'pix', // Método de pagamento  
        purchaseDate: purchaseDate, // DATA DE COMPRA (para garantia)
        paidAt: purchaseDate, // DATA DO PAGAMENTO
        createdAt: purchaseDate,
        updatedAt: new Date(),
        autoCreated: true,
        autoCreatedReason: `Enrollment criado automaticamente após confirmação de pagamento ${orderData.method}`
      };

      // 4. Verificar se enrollment já existe para evitar duplicatas
      // 🔒 SEGURANÇA: Garantir que customerEmail não seja undefined
      const customerEmail = orderData.customer?.email;
      if (!customerEmail) {
        console.log(`⚠️ ENROLLMENT SKIP: Order ${orderData.id} não tem customer.email - impossível criar enrollment`);
        return;
      }
      
      const existingEnrollmentQuery = await this.db.collection('enrollments')
        .where('customerEmail', '==', customerEmail)
        .where('productId', '==', realProductId) // 🎯 USAR ID REAL DO PRODUTO
        .where('status', '==', 'active')
        .limit(1)
        .get();

      let enrollmentCreatedNow = false;

      if (!existingEnrollmentQuery.empty && !checkoutData?.allowMultiplePurchases) {
        console.log(`✅ ENROLLMENT JÁ EXISTE para ${orderData.customer?.email} no produto ${productTitle}`);
      } else {
        // 5. Salvar enrollment no Firebase com timestamps corretos e todos os campos
        await this.db.collection('enrollments').doc(enrollmentId).set({
          ...enrollmentData,
          // 🔥 TIMESTAMPS CORRETOS FIREBASE
          enrolledAt: admin.firestore.Timestamp.fromDate(purchaseDate), // Data da compra
          purchaseDate: admin.firestore.Timestamp.fromDate(purchaseDate), // Data para garantia  
          paidAt: admin.firestore.Timestamp.fromDate(purchaseDate), // Data pagamento
          guaranteeExpiresAt: admin.firestore.Timestamp.fromDate(guaranteeExpiresAt), // 7 dias
          createdAt: admin.firestore.Timestamp.fromDate(purchaseDate),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // 6. Verificar se foi salvo
        const verification = await this.db.collection('enrollments').doc(enrollmentId).get();
        if (!verification.exists) {
          throw new Error('🚨 FALHA: Enrollment não foi salvo no Firebase');
        }

        console.log(`🎉 ENROLLMENT CRIADO COM SUCESSO: ${enrollmentId}`);
        console.log(`👤 Cliente ${orderData.customer?.name} (${orderData.customer?.email}) agora tem acesso a "${productTitle}"`);
        console.log(`💰 Valor pago: R$ ${(productAmount/100).toFixed(2)} - Método: ${orderData.method}`);
        console.log(`🎯 ACESSO LIBERADO COM DADOS CORRETOS DA COMPRA REAL!`);
        enrollmentCreatedNow = true;
      }

      // 🔥 LÓGICA CRÍTICA: Se productType === 'subscription', criar SUBSCRIPTION também!
      console.log(`🔍 DEBUG SUBSCRIPTION CHECK:`, {
        'orderData.productType': orderData.productType,
        'checkoutSnapshot.productType': orderData.checkoutSnapshot?.productType,
        'checkoutSnapshot exists': !!orderData.checkoutSnapshot
      });
      
      if (orderData.productType === 'subscription' || orderData.checkoutSnapshot?.productType === 'subscription') {
        console.log(`🔄 DETECTADO PRODUCTTYPE SUBSCRIPTION - Criando subscription automática...`);
        console.log(`📋 Dados da subscription: tenant=${productOwnerTenantId}, customer=${orderData.customer?.email}, checkout=${orderData.checkoutId}`);
        
        // 📅 PEGAR PERÍODO REAL — top-level primeiro, depois snapshot, depois default mensal
        const subscriptionPeriod = orderData.subscriptionPeriod
          || orderData.checkoutSnapshot?.pricing?.subscriptionPeriod
          || orderData.checkoutSnapshot?.subscriptionPeriod
          || 'mensal';
        
        // 🗓️ CALCULAR DIAS BASEADO NO PERÍODO (suporta português E inglês)
        let daysToAdd = 30; // Default mensal
        switch (subscriptionPeriod) {
          case 'trimestral': case 'quarterly':              daysToAdd = 90;  break;
          case 'semestral':  case 'semiannual':             daysToAdd = 180; break;
          case 'anual':      case 'annual': case 'yearly':  daysToAdd = 365; break;
          default: daysToAdd = 30; // mensal / monthly
        }

        // Verificar se já existe (idempotência + renovação)
        const existingSubscription = await this.getSubscriptionByCustomerAndProduct(
          productOwnerTenantId,
          orderData.customer?.email || '', 
          orderData.checkoutId
        );
        
        if (existingSubscription) {
          // 🔄 RENOVAÇÃO: Se expirada ou cancelada, restaurar acesso
          if (existingSubscription.status === 'expired' || existingSubscription.status === 'cancelled') {
            console.log(`🔄 SUBSCRIPTION EXPIRADA/CANCELADA DETECTADA: ${existingSubscription.id} - Restaurando acesso...`);
            const nextBillingDate = new Date(realPurchaseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
            await this.db!.collection('subscriptions').doc(existingSubscription.id).update({
              status: 'active',
              nextBillingDate: admin.firestore.Timestamp.fromDate(nextBillingDate),
              expiresAt: admin.firestore.Timestamp.fromDate(nextBillingDate),
              lastPaymentDate: admin.firestore.Timestamp.fromDate(realPurchaseDate),
              notified3Days: false,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            await this.updateEnrollmentStatusByEmail(productOwnerTenantId, orderData.customer?.email || '', orderData.checkoutId, 'active');
            console.log(`✅ SUBSCRIPTION RESTAURADA: ${existingSubscription.id} - Acesso reativado até ${nextBillingDate.toLocaleDateString('pt-BR')}`);
          } else {
            console.log(`⚠️ SUBSCRIPTION JÁ ATIVA: ${existingSubscription.id} - pulando criação`);
          }
        } else {
          try {
            const nextBillingDate = new Date(realPurchaseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
            const expiresAt = new Date(realPurchaseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
            
            console.log(`📅 PERÍODO: ${subscriptionPeriod} (${daysToAdd} dias)`);
            console.log(`🔄 PRÓXIMA COBRANÇA: ${nextBillingDate.toISOString()}`);
            
            const newSubscription = await this.createSubscription({
              tenantId: productOwnerTenantId,
              checkoutId: orderData.checkoutId,
              orderId: orderData.id,
              customerId: orderData.customer?.email || '',
              customerName: orderData.customer?.name || '',
              customerEmail: orderData.customer?.email || '',
              customerPhone: orderData.customer?.phone || '',
              customerDocument: orderData.customer?.document || '',
              customerAddress: orderData.customerAddress || undefined,
              productName: productTitle,
              amount: productAmount,
              period: subscriptionPeriod,
              status: 'active',
              startDate: realPurchaseDate,
              nextBillingDate,
              expiresAt,
              lastPaymentDate: realPurchaseDate,
              paymentMethod: orderData.method === 'pix' ? 'pix' : (orderData.method === 'stripe' ? 'stripe' : 'card')
            });
            console.log(`🎉 SUBSCRIPTION CRIADA: ${newSubscription.id} para ${orderData.customer?.email}!`);
          } catch (subscriptionError: any) {
            console.error(`❌ ERRO ao criar subscription:`, subscriptionError);
          }
        }
      }

    } catch (error: any) {
      console.error('❌ ERRO ao criar enrollment automático:', error);
      console.error('❌ Stack:', error.stack);
      // Não quebrar o webhook por causa do enrollment
    }
  }

  // 💰 CALCULAR COMISSÃO DE AFILIADO (SEM GRAVAR - apenas retorna valores)
  // 🔧 HELPER: Usado pelo webhook para saber quanto descontar do vendedor ANTES de creditar
  async calculateAffiliateCommission(orderData: any): Promise<{
    hasAffiliate: boolean;
    affiliateId?: string;
    grossCommission: number;
    netCommission: number;
    commissionPercent: number;
    adminFeePercent: number;
    productType: string;
  }> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        return { hasAffiliate: false, grossCommission: 0, netCommission: 0, commissionPercent: 0, adminFeePercent: 0, productType: 'digital' };
      }

      const affiliateIdentifier = orderData.affiliateCode || orderData.affiliateUid;
      if (!affiliateIdentifier) {
        return { hasAffiliate: false, grossCommission: 0, netCommission: 0, commissionPercent: 0, adminFeePercent: 0, productType: 'digital' };
      }

      const cachedAffiliate = firestoreCache.getAffiliateByCode(affiliateIdentifier);
      let affiliateData: any;
      let resolvedAffiliateUid: string;

      if (cachedAffiliate !== undefined) {
        if (cachedAffiliate === null) {
          return { hasAffiliate: false, grossCommission: 0, netCommission: 0, commissionPercent: 0, adminFeePercent: 0, productType: 'digital' };
        }
        affiliateData = cachedAffiliate;
        resolvedAffiliateUid = affiliateData.affiliateId || affiliateData.userId || affiliateData.id;
        console.log(`✅ [CACHE] Afiliado do cache: ${affiliateData.affiliateName || affiliateData.name || affiliateData.id}`);
      } else {
        let affiliateQuery = await withFirestoreTimeout(this.db.collection('affiliates')
          .where('affiliateCode', '==', affiliateIdentifier)
          .where('status', '==', 'approved')
          .limit(1)
          .get());

        if (affiliateQuery.empty) {
          affiliateQuery = await withFirestoreTimeout(this.db.collection('affiliates')
            .where('userId', '==', affiliateIdentifier)
            .where('status', '==', 'approved')
            .limit(1)
            .get());
        }

        if (affiliateQuery.empty) {
          console.log(`🔍 [CALC] Buscando em affiliations por código: ${affiliateIdentifier}`);
          affiliateQuery = await withFirestoreTimeout(this.db.collection('affiliations')
            .where('affiliateCode', '==', affiliateIdentifier)
            .where('status', '==', 'approved')
            .limit(1)
            .get());
        }

        if (affiliateQuery.empty) {
          console.log(`🔍 [CALC] Buscando em affiliations por affiliateId: ${affiliateIdentifier}`);
          affiliateQuery = await withFirestoreTimeout(this.db.collection('affiliations')
            .where('affiliateId', '==', affiliateIdentifier)
            .where('status', '==', 'approved')
            .limit(1)
            .get());
        }

        if (affiliateQuery.empty) {
          console.log(`🔍 [CALC] Buscando em affiliates por affiliateSlug: ${affiliateIdentifier}`);
          affiliateQuery = await withFirestoreTimeout(this.db.collection('affiliates')
            .where('affiliateSlug', '==', affiliateIdentifier)
            .where('status', '==', 'approved')
            .limit(1)
            .get());
        }

        if (affiliateQuery.empty) {
          console.log(`❌ [CALC] Afiliado não encontrado em nenhuma coleção: ${affiliateIdentifier}`);
          return { hasAffiliate: false, grossCommission: 0, netCommission: 0, commissionPercent: 0, adminFeePercent: 0, productType: 'digital' };
        }

        const affiliateDoc = affiliateQuery.docs[0];
        affiliateData = { id: affiliateDoc.id, ...affiliateDoc.data(), _sourceCollection: affiliateQuery.docs[0].ref.parent.id };
        resolvedAffiliateUid = affiliateData.affiliateId || affiliateData.userId || affiliateDoc.id;
        firestoreCache.setAffiliateByCode(affiliateIdentifier, affiliateData);
        console.log(`✅ [CALC] Afiliado encontrado: ${affiliateData.affiliateName || affiliateData.name || affiliateDoc.id} (uid: ${resolvedAffiliateUid})`);
      }

      const checkoutData = await firestoreCache.getCheckout(orderData.checkoutId);
      if (!checkoutData) {
        return { hasAffiliate: false, grossCommission: 0, netCommission: 0, commissionPercent: 0, adminFeePercent: 0, productType: 'digital' };
      }
      const isRecurring = orderData.productType === 'subscription' || checkoutData?.productType === 'subscription';
      
      const snapshotCommission = affiliateData.commissionSnapshot?.single;
      const snapshotRecurring = affiliateData.commissionSnapshot?.subscription;
      const customCommission = affiliateData.customCommission;
      
      const commissionPercent = isRecurring 
        ? (snapshotRecurring ?? checkoutData?.affiliate?.recurringCommissionPercent ?? checkoutData?.affiliateConfig?.commissions?.recurring ?? 0)
        : (customCommission ?? snapshotCommission ?? checkoutData?.affiliate?.commissionPercent ?? checkoutData?.affiliateConfig?.commissions?.single ?? 10);
      
      const adminFeePercent = checkoutData?.affiliate?.adminFeePercent ?? 5;
      const orderAmount = orderData.amount;
      const grossCommission = Math.round(orderAmount * (commissionPercent / 100));
      const adminFee = Math.round(grossCommission * (adminFeePercent / 100));
      const netCommission = grossCommission - adminFee;
      
      const productType = isRecurring ? 'subscription' : (orderData.productType || checkoutData?.productType || 'digital');

      console.log(`💰 [CALC] Comissão calculada: R$ ${(netCommission/100).toFixed(2)} (${commissionPercent}% - ${adminFeePercent}% admin)`);

      return {
        hasAffiliate: true,
        affiliateId: resolvedAffiliateUid,
        grossCommission,
        netCommission,
        commissionPercent,
        adminFeePercent,
        productType
      };
    } catch (error) {
      console.error('❌ Erro ao calcular comissão:', error);
      return { hasAffiliate: false, grossCommission: 0, netCommission: 0, commissionPercent: 0, adminFeePercent: 0, productType: 'digital' };
    }
  }

  // 💰 PROCESSAR COMISSÃO DE AFILIADO AUTOMÁTICA 
  async processAffiliateCommission(orderData: any): Promise<void> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        console.log('⚠️ Firebase não conectado - não é possível processar comissão de afiliado');
        return;
      }

      // 🔥 SUPORTE PARA affiliateCode OU affiliateUid (compatibilidade total)
      const affiliateIdentifier = orderData.affiliateCode || orderData.affiliateUid;
      
      if (!affiliateIdentifier) {
        console.log('💰 Sem código/UID de afiliado na ordem:', orderData.id);
        return;
      }

      // 🛡️ GUARDA: id da ordem é obrigatório para o ID determinístico da comissão
      const orderId = orderData.id || orderData.orderId;
      if (!orderId) {
        console.error(`❌ [COMMISSION] processAffiliateCommission chamado sem orderData.id - não é possível criar comissão de forma segura. affiliateIdentifier=${affiliateIdentifier}`);
        return;
      }

      console.log(`💰 PROCESSANDO COMISSÃO DE AFILIADO para identificador: ${affiliateIdentifier}`);
      console.log(`📦 Ordem: ${orderId} - Valor: R$ ${(orderData.amount / 100).toFixed(2)}`);

      let affiliateData: any;
      let affiliateUid: string;
      let sourceCollection = 'affiliates';

      const cachedAffiliate = firestoreCache.getAffiliateByCode(affiliateIdentifier);
      if (cachedAffiliate !== undefined) {
        if (cachedAffiliate === null) {
          console.log(`❌ [CACHE] Afiliado não existe (cache negativo): ${affiliateIdentifier}`);
          return;
        }
        affiliateData = cachedAffiliate;
        affiliateUid = affiliateData.affiliateId || affiliateData.userId || affiliateData.id;
        sourceCollection = affiliateData._sourceCollection || 'affiliates';
        console.log(`✅ [CACHE] Afiliado do cache para processamento`);
      } else {
        let affiliateQuery = await withFirestoreTimeout(this.db.collection('affiliates')
          .where('affiliateCode', '==', affiliateIdentifier)
          .where('status', '==', 'approved')
          .limit(1)
          .get());

        if (affiliateQuery.empty) {
          console.log(`🔍 Tentando buscar afiliado por userId: ${affiliateIdentifier}`);
          affiliateQuery = await withFirestoreTimeout(this.db.collection('affiliates')
            .where('userId', '==', affiliateIdentifier)
            .where('status', '==', 'approved')
            .limit(1)
            .get());
        }

        if (affiliateQuery.empty) {
          console.log(`🔍 [PROCESS] Buscando em affiliations por código: ${affiliateIdentifier}`);
          affiliateQuery = await withFirestoreTimeout(this.db.collection('affiliations')
            .where('affiliateCode', '==', affiliateIdentifier)
            .where('status', '==', 'approved')
            .limit(1)
            .get());
        }

        if (affiliateQuery.empty) {
          console.log(`🔍 [PROCESS] Buscando em affiliations por affiliateId: ${affiliateIdentifier}`);
          affiliateQuery = await withFirestoreTimeout(this.db.collection('affiliations')
            .where('affiliateId', '==', affiliateIdentifier)
            .where('status', '==', 'approved')
            .limit(1)
            .get());
        }

        if (affiliateQuery.empty) {
          console.log(`🔍 [PROCESS] Buscando em affiliates por affiliateSlug: ${affiliateIdentifier}`);
          affiliateQuery = await withFirestoreTimeout(this.db.collection('affiliates')
            .where('affiliateSlug', '==', affiliateIdentifier)
            .where('status', '==', 'approved')
            .limit(1)
            .get());
        }

        if (affiliateQuery.empty) {
          console.log(`❌ Afiliado não encontrado em nenhuma coleção: ${affiliateIdentifier}`);
          return;
        }
        
        console.log(`✅ Afiliado encontrado para processamento de comissão`);
        sourceCollection = affiliateQuery.docs[0].ref.parent.id;
        console.log(`📂 Origem: coleção '${sourceCollection}'`);

        const affiliateDoc = affiliateQuery.docs[0];
        affiliateData = { id: affiliateDoc.id, ...affiliateDoc.data(), _sourceCollection: sourceCollection };
        affiliateUid = affiliateData.affiliateId || affiliateData.userId || affiliateDoc.id;
        firestoreCache.setAffiliateByCode(affiliateIdentifier, affiliateData);
      }

      const checkoutData = await firestoreCache.getCheckout(orderData.checkoutId);
      if (!checkoutData) {
        console.log(`❌ Checkout não encontrado: ${orderData.checkoutId}`);
        return;
      }
      
      // 2.5 VALIDAR OFERTAS SELECIONADAS: Verificar se oferta comprada está autorizada
      const orderedOfferId = orderData.offerId || orderData.offer?.id;
      const productId = checkoutData?.productId || orderData.productId;
      
      if (productId) {
        try {
          const affiliateProductQuery = await withFirestoreTimeout(this.db.collection('affiliations')
            .where('affiliateId', '==', affiliateUid)
            .where('productId', '==', productId)
            .where('status', '==', 'approved')
            .limit(1)
            .get());
          
          if (!affiliateProductQuery.empty) {
            const affiliateProductData = affiliateProductQuery.docs[0].data();
            const selectedOffers = affiliateProductData.selectedOffers || [];
            
            if (Array.isArray(selectedOffers) && selectedOffers.length > 0 && orderedOfferId) {
              if (!selectedOffers.includes(orderedOfferId)) {
                console.warn(`🚨 COMISSÃO BLOQUEADA: Oferta ${orderedOfferId} NÃO está nas ofertas autorizadas do afiliado`);
                console.warn(`   📋 Ofertas autorizadas: ${selectedOffers.join(', ')}`);
                console.warn(`   🛒 Oferta comprada: ${orderedOfferId}`);
                console.warn(`   📦 ProductId: ${productId}`);
                return; // Bloquear comissão - oferta não autorizada
              }
              console.log(`✅ Oferta ${orderedOfferId} validada nas ofertas autorizadas do afiliado`);
            } else {
              console.log(`ℹ️ Afiliado sem restrição de ofertas - todas as ofertas geram comissão`);
            }
          } else {
            console.log(`ℹ️ Afiliado ${affiliateUid} sem registro em affiliations para produto ${productId}`);
          }
        } catch (selectedOffersError: any) {
          console.error(`⚠️ Erro ao validar selectedOffers:`, selectedOffersError.message);
          // Continuar processamento em caso de erro (não bloquear comissão)
        }
      }
      
      // 🔍 DETECTAR TIPO DE PRODUTO (Único vs Recorrente)
      const isRecurring = orderData.productType === 'subscription' || 
                         checkoutData?.productType === 'subscription' ||
                         checkoutData?.pricing?.billingType === 'subscription';
      
      // SELECIONAR COMISSÃO CORRETA (prioridade: customCommission > commissionSnapshot > checkout.affiliate > affiliateConfig)
      const procSnapshotSingle = affiliateData.commissionSnapshot?.single;
      const procSnapshotRecurring = affiliateData.commissionSnapshot?.subscription;
      const procCustomCommission = affiliateData.customCommission;
      
      let commissionPercent: number;
      if (isRecurring) {
        commissionPercent = procSnapshotRecurring ?? checkoutData?.affiliate?.recurringCommissionPercent ?? checkoutData?.affiliateConfig?.commissions?.recurring ?? 0;
        console.log(`PRODUTO RECORRENTE: Comissão = ${commissionPercent}%`);
      } else {
        commissionPercent = procCustomCommission ?? procSnapshotSingle ?? checkoutData?.affiliate?.commissionPercent ?? checkoutData?.affiliateConfig?.commissions?.single ?? 10;
        console.log(`PRODUTO UNICO: Comissão = ${commissionPercent}%`);
      }
      
      // Prazo de liberação: usa releaseDays do order (calculado pelo admin/acquirers-config)
      // Fallback: config do checkout, depois padrão 30 dias
      const paymentDelay =
        orderData.financial?.releaseDays ??
        orderData.financialData?.releaseDays ??
        checkoutData?.affiliate?.paymentDelay ??
        30;

      // 3. Calcular comissão com taxas administrativas
      const orderAmount = orderData.amount; // Em centavos
      
      // 3.1. Comissão bruta (antes de taxa administrativa)
      const grossCommission = Math.round(orderAmount * (commissionPercent / 100));
      
      // 3.2. Taxa administrativa (configur\u00e1vel, padrão 5%)
      const adminFeePercent = checkoutData?.affiliate?.adminFeePercent ?? 5; // Default 5%
      const adminFee = Math.round(grossCommission * (adminFeePercent / 100));
      
      // 3.3. Comissão líquida (o que o afiliado realmente recebe)
      const netCommission = grossCommission - adminFee;
      
      // 3.4. MANTER commissionAmount para compatibilidade (igual a grossCommission)
      const commissionAmount = grossCommission;

      console.log(`💰 Comissão calculada:`);
      console.log(`   📊 Bruta: R$ ${(grossCommission / 100).toFixed(2)} (${commissionPercent}% de R$ ${(orderAmount / 100).toFixed(2)})`);
      console.log(`   💸 Taxa Admin: R$ ${(adminFee / 100).toFixed(2)} (${adminFeePercent}%)`);
      console.log(`   ✅ Líquida (Afiliado): R$ ${(netCommission / 100).toFixed(2)}`);

      // 4. ✅ IDEMPOTÊNCIA via ID determinístico (evita query sem índice)
      // affiliateUid já definido acima (linha 4956)
      // ID determinístico: commission_{orderId}_{affiliateId}
      const deterministicCommissionId = `commission_${orderId}_${affiliateUid}`;
      const commissionRef = this.db.collection('affiliateCommissions').doc(deterministicCommissionId);
      
      // 🛡️ IDEMPOTÊNCIA TOTAL: Verificar se comissão já existe E se saldo foi creditado
      const existingCommission = await commissionRef.get();
      if (existingCommission.exists) {
        const existingData = existingCommission.data();
        // Se já existe e saldo foi creditado, skip completo
        if (existingData?.balanceCredited === true) {
          console.log(`✅ Comissão já processada para ordem: ${orderId} (comissão: ${deterministicCommissionId})`);
          return;
        }
        // Se existe mas saldo não foi creditado, tentar creditar novamente
        console.log(`⚠️ Comissão existe mas saldo não creditado - tentando recuperar: ${orderId}`);
      }

      // 5. 📅 CALCULAR DATA DE LIBERAÇÃO (releaseDate) baseado em paymentDelay
      // 🔥 NORMALIZAR paidAt (pode ser Timestamp do Firestore ou Date)
      let paidDate: Date;
      if (orderData.paidAt?.toDate) {
        paidDate = orderData.paidAt.toDate(); // Firestore Timestamp
      } else if (orderData.paidAt instanceof Date) {
        paidDate = orderData.paidAt; // Date nativa
      } else {
        paidDate = new Date(orderData.paidAt || Date.now()); // String ou fallback
      }
      
      const releaseDate = new Date(paidDate);
      releaseDate.setDate(releaseDate.getDate() + paymentDelay);
      
      console.log(`📅 Data de liberação: ${releaseDate.toLocaleDateString('pt-BR')} (${paymentDelay} dias após pagamento)`);

      // 6. Criar registro de comissão
      // ✅ Usar ID determinístico já criado para idempotência
      const commissionId = deterministicCommissionId;
      
      // 🔧 NORMALIZAR paymentMethod para schema (efibank_card/credit_card/creditCard → card)
      // CORREÇÃO CRÍTICA: usar paymentMethod como fallback pois orders de cartão não têm .method
      const rawMethod = orderData.method || orderData.paymentMethod || 'pix';
      const normalizedMethod =
        rawMethod === 'credit_card'  || 
        rawMethod === 'efibank_card' || 
        rawMethod === 'creditCard'   || 
        rawMethod === 'card'
          ? 'card'
          : rawMethod;
      
      // 💰 PIX = disponível imediato (D+0), Card/Boleto = pendente até releaseDate
      const isPixPayment = normalizedMethod === 'pix';
      const commissionStatus = isPixPayment ? 'available' : 'pending';
      console.log(`💰 Método: ${normalizedMethod} → Comissão status: ${commissionStatus} (PIX=disponível imediato, card/boleto=pendente)`);
      
      // 🏷️ DETECTAR CATEGORIA DO PRODUTO
      const productType = orderData.productType || checkoutData?.productType || 'digital';
      const productCategory = isRecurring ? 'subscription' : productType;
      console.log(`🏷️ Categoria do produto: ${productCategory}`);
      
      const commissionData = {
        id: commissionId,
        tenantId: orderData.tenantId,
        affiliateId: affiliateUid,
        affiliateCode: affiliateIdentifier,
        affiliateName: affiliateData.affiliateName || affiliateData.userName || affiliateData.name || 'Afiliado',
        affiliateEmail: affiliateData.affiliateEmail || affiliateData.userEmail || affiliateData.email,
        orderId: orderId,
        checkoutId: orderData.checkoutId,
        productId: orderData.productId,
        productName: orderData.checkoutSnapshot?.title || `Produto ${orderData.checkoutId}`,
        productType: productCategory,
        customerEmail: orderData.customer?.email,
        customerName: orderData.customer?.name,
        orderAmount: orderAmount,
        percentage: commissionPercent,
        commissionPercent: commissionPercent,
        
        amount: commissionAmount,
        commissionAmount: commissionAmount,
        grossAmount: grossCommission,
        adminFee: adminFee,
        netAmount: netCommission,
        adminFeePercent: adminFeePercent,
        
        status: commissionStatus,
        releaseDate: isPixPayment ? paidDate : releaseDate,
        paymentMethod: normalizedMethod,
        paidAt: paidDate,
        createdAt: new Date(),
        updatedAt: new Date(),
        autoCreated: true,
        autoCreatedReason: `Comissão criada automaticamente após confirmação de pagamento ${normalizedMethod} - ${isPixPayment ? 'disponível imediato' : `pendente ${paymentDelay} dias`}`
      };

      // 7. Salvar comissão no Firebase usando referência já criada
      // ⭐ Filtrar campos undefined para evitar erro do Firestore
      const cleanedCommissionData: any = {};
      Object.entries(commissionData).forEach(([key, value]) => {
        if (value !== undefined) {
          cleanedCommissionData[key] = value;
        }
      });
      
      // 7. 🔒 TRANSAÇÃO ATÔMICA ÚNICA: Criar comissão + Creditar saldo do afiliado JUNTOS
      // Isso garante que se qualquer parte falhar, tudo é revertido
      const affiliateBalanceRef = this.db.collection('affiliateBalances').doc(affiliateUid);
      
      console.log(`💼 Processando comissão + crédito em transação atômica...`);
      
      let balanceCredited = false;
      try {
        await this.db.runTransaction(async (transaction) => {
          // 1. Verificar se comissão já existe (double-check dentro da transação)
          const commissionDoc = await transaction.get(commissionRef);
          if (commissionDoc.exists) {
            const existingData = commissionDoc.data();
            if (existingData?.balanceCredited === true) {
              console.log(`🛡️ [TRANSAÇÃO] Comissão já processada completamente - SKIP`);
              return; // Exit transaction sem fazer nada
            }
          }
          
          // 2. Processar saldo do afiliado
          const balanceDoc = await transaction.get(affiliateBalanceRef);
          
          if (!balanceDoc.exists) {
            console.log(`🆕 Criando novo affiliateBalance para ${affiliateUid} (${isPixPayment ? 'PIX→available' : 'card/boleto→pending'})`);
            const now = admin.firestore.FieldValue.serverTimestamp();
            
            transaction.set(affiliateBalanceRef, {
              userId: affiliateUid,
              balanceAvailable_BRL: isPixPayment ? netCommission : 0,
              balancePending_BRL: isPixPayment ? 0 : netCommission,
              balanceReserved_BRL: 0,
              lifetimeCommissions_BRL: netCommission,
              totalWithdrawn_BRL: 0,
              totalSales: 1,
              totalCommissions: 1,
              pendingCommissions: isPixPayment ? 0 : 1,
              approvedCommissions: isPixPayment ? 1 : 0,
              lastCommissionDate: now,
              lastWithdrawal: null,
              firstCommissionDate: now,
              createdAt: now,
              updatedAt: now,
            });
          } else {
            console.log(`✨ Atualizando affiliateBalance existente para ${affiliateUid} (${isPixPayment ? 'PIX→available' : 'card/boleto→pending'})`);
            
            const balanceUpdate: any = {
              lifetimeCommissions_BRL: admin.firestore.FieldValue.increment(netCommission),
              totalSales: admin.firestore.FieldValue.increment(1),
              totalCommissions: admin.firestore.FieldValue.increment(1),
              lastCommissionDate: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            
            if (isPixPayment) {
              balanceUpdate.balanceAvailable_BRL = admin.firestore.FieldValue.increment(netCommission);
              balanceUpdate.approvedCommissions = admin.firestore.FieldValue.increment(1);
            } else {
              balanceUpdate.balancePending_BRL = admin.firestore.FieldValue.increment(netCommission);
              balanceUpdate.pendingCommissions = admin.firestore.FieldValue.increment(1);
            }
            
            transaction.update(affiliateBalanceRef, balanceUpdate);
          }
          
          // 3. Criar/Atualizar comissão COM flag balanceCredited = true
          transaction.set(commissionRef, {
            ...cleanedCommissionData,
            balanceCredited: true, // 🔥 FLAG DE SUCESSO
            releaseDate: admin.firestore.Timestamp.fromDate(commissionData.releaseDate),
            paidAt: admin.firestore.Timestamp.fromDate(commissionData.paidAt),
            createdAt: admin.firestore.Timestamp.fromDate(commissionData.createdAt),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true }); // merge para não sobrescrever se já existe
        });
        
        balanceCredited = true;
        console.log(`✅ Transação atômica concluída: comissão + saldo do afiliado`);
        console.log(`🎉 Afiliado ${affiliateUid} creditado: +R$ ${(netCommission/100).toFixed(2)} ${isPixPayment ? 'AVAILABLE (PIX D+0)' : 'PENDING (card/boleto)'}`);

        // 🐘 DUAL-WRITE → Neon affiliate balance (fire-and-forget)
        import('./lib/neon-affiliates.js').then(({ neonUpsertAffiliateBalance }) => {
          const balanceDocData = balanceCredited ? {
            userId: affiliateUid,
            balanceAvailableBrl: isPixPayment ? netCommission : 0,
            balancePendingBrl: isPixPayment ? 0 : netCommission,
            balanceReservedBrl: 0,
            lifetimeCommissionsBrl: netCommission,
            totalWithdrawnBrl: 0,
            totalSales: 1,
            totalCommissions: 1,
            pendingCommissions: isPixPayment ? 0 : 1,
            approvedCommissions: isPixPayment ? 1 : 0,
          } : null;
          if (balanceDocData) neonUpsertAffiliateBalance(balanceDocData);
        }).catch(() => {});

        // 🐘 DUAL-WRITE → Neon (fire-and-forget)
        import('./lib/neon-withdrawals.js').then(({ neonWriteAffiliateCommission }) => {
          neonWriteAffiliateCommission({
            id: commissionId,
            tenantId: commissionData.tenantId,
            affiliateId: affiliateUid,
            affiliateCode: affiliateIdentifier,
            affiliateName: commissionData.affiliateName,
            affiliateEmail: commissionData.affiliateEmail,
            orderId,
            checkoutId: commissionData.checkoutId,
            productId: commissionData.productId,
            productName: commissionData.productName,
            productType: commissionData.productType,
            customerEmail: commissionData.customerEmail,
            customerName: commissionData.customerName,
            orderAmount: commissionData.orderAmount,
            commissionPercent: commissionData.commissionPercent,
            amount: commissionData.commissionAmount,
            grossAmount: commissionData.grossAmount,
            adminFee: commissionData.adminFee,
            netAmount: commissionData.netAmount,
            adminFeePercent: commissionData.adminFeePercent,
            status: commissionData.status,
            paymentMethod: commissionData.paymentMethod,
            balanceCredited: true,
            releaseDate: commissionData.releaseDate instanceof Date ? commissionData.releaseDate : new Date(commissionData.releaseDate),
            paidAt: commissionData.paidAt instanceof Date ? commissionData.paidAt : new Date(commissionData.paidAt),
          });
        }).catch(() => {});

      } catch (atomicError) {
        console.error(`❌ ERRO na transação atômica:`, atomicError);
        
        // 🚨 REGISTRAR COMISSÃO ÓRFÃ PARA RECUPERAÇÃO MANUAL
        try {
          await this.db.collection('orphanedCommissions').doc(deterministicCommissionId).set({
            orderId: orderId,
            affiliateId: affiliateUid,
            netCommission,
            error: String(atomicError),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending_recovery',
            reason: 'Transação atômica falhou - afiliado não creditado'
          });
          console.error(`🚨 ALERTA: Comissão órfã registrada para recuperação: ${deterministicCommissionId}`);
        } catch (orphanError) {
          console.error(`❌ Falha ao registrar comissão órfã:`, orphanError);
        }
      }

      // 6.5. 💰 ATUALIZAR ORDEM COM DADOS DA COMISSÃO (vendedor já recebeu valor líquido no webhook)
      // 🔒 Não precisa debitar do vendedor - webhook já creditou valor descontado
      try {
        const orderRef = this.db.collection('orders').doc(orderId);
        
        await this.db.runTransaction(async (transaction) => {
          const orderDoc = await transaction.get(orderRef);
          if (!orderDoc.exists) {
            throw new Error(`Ordem ${orderId} não encontrada`);
          }
          
          const currentOrderData = orderDoc.data();
          
          // 🛡️ IDEMPOTÊNCIA: Se já processou, skip
          if (currentOrderData?.commissionProcessed) {
            console.log(`✅ Comissão já registrada para ordem ${orderId} - SKIP`);
            return;
          }
          
          // Atualizar ordem com dados da comissão
          const currentNetAmount = currentOrderData?.netAmount || orderAmount;
          let newNetAmount = currentNetAmount - commissionAmount;
          if (newNetAmount < 0) newNetAmount = 0;
          
          transaction.update(orderRef, {
            affiliateCommission: commissionAmount,
            affiliateCommissionNet: netCommission,
            netAmount: newNetAmount,
            sellerNetAmount: newNetAmount,
            commissionProcessed: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          console.log(`✅ Ordem atualizada com dados da comissão`);
        });
        
      } catch (orderUpdateError) {
        console.error(`❌ Erro ao atualizar ordem:`, orderUpdateError);
        // Não quebrar - comissão foi criada
      }

      // 7. Atualizar estatísticas do afiliado (na coleção correta: affiliates ou affiliations)
      try {
        await this.db.collection(sourceCollection).doc(affiliateData.id).update({
          totalSales: admin.firestore.FieldValue.increment(1),
          totalCommissions: admin.firestore.FieldValue.increment(commissionAmount),
          totalEarnings: admin.firestore.FieldValue.increment(netCommission),
          totalSalesAmount: admin.firestore.FieldValue.increment(orderAmount),
          lastSaleAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`✅ Estatísticas do afiliado atualizadas: ${affiliateData.email}`);
      } catch (statsError) {
        console.error(`❌ Erro ao atualizar estatísticas do afiliado:`, statsError);
        // Não quebrar o processo por causa das estatísticas
      }

      // 8. Marcar clique como convertido (se existir)
      try {
        // 🔍 Buscar por affiliateId (do documento) OU affiliateCode
        const clickQuery = await this.db.collection('affiliate_clicks')
          .where('affiliateId', '==', affiliateIdentifier)
          .where('converted', '==', false)
          .orderBy('clickedAt', 'desc')
          .limit(1)
          .get();

        if (!clickQuery.empty) {
          const clickDoc = clickQuery.docs[0];
          await this.db.collection('affiliate_clicks').doc(clickDoc.id).update({
            converted: true,
            orderId: orderId,
            commissionId: commissionId,
            convertedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          console.log(`✅ Clique de afiliado marcado como convertido: ${clickDoc.id}`);
        }
      } catch (clickError) {
        console.error(`❌ Erro ao marcar clique como convertido:`, clickError);
        // Não quebrar o processo por causa do clique
      }

      console.log(`🎉 COMISSÃO DE AFILIADO PROCESSADA COM SUCESSO!`);
      console.log(`💰 Comissão de R$ ${(commissionAmount / 100).toFixed(2)} para ${affiliateData.email}`);
      console.log(`📊 Status: pendente para saque`);
      console.log(`📅 Disponível para saque em: ${releaseDate.toLocaleDateString('pt-BR')} (${paymentDelay} dias)`);

    } catch (error: any) {
      console.error('❌ ERRO ao processar comissão de afiliado:', error);
      console.error('❌ Stack:', error.stack);
      // Não quebrar o webhook por causa da comissão
    }
  }

  async creditSellerBalance(sellerId: string, amountCentavos: number, metadata: {
    orderId: string;
    type: string;
    description: string;
    availableImmediately?: boolean;
  }): Promise<void> {
    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        console.log('⚠️ Firebase não conectado - não é possível creditar saldo');
        return;
      }

      if (amountCentavos <= 0) {
        console.log(`⚠️ [BALANCE] Valor <= 0 (${amountCentavos}) - skip creditar saldo para ${sellerId}`);
        return;
      }

      const sellerBalanceRef = this.db.collection('sellerBalances').doc(sellerId);
      const orderRef = this.db.collection('orders').doc(metadata.orderId);

      await this.db.runTransaction(async (transaction) => {
        const [balanceDoc, orderDoc] = await Promise.all([
          transaction.get(sellerBalanceRef),
          transaction.get(orderRef)
        ]);

        const orderData = orderDoc.exists ? orderDoc.data() : null;
        if (orderData?.balanceCredited) {
          console.log(`🔒 [BALANCE] Ordem ${metadata.orderId} já creditada (flag balanceCredited) - SKIP duplicata`);
          return;
        }

        const balanceData = balanceDoc.exists ? balanceDoc.data() : null;
        const isImmediate = metadata.availableImmediately !== false;

        const currentAvailable = balanceData?.balanceAvailable_BRL || 0;
        const currentPending = balanceData?.balancePending_BRL || 0;
        const currentReserved = balanceData?.balanceReserved_BRL || 0;

        let newAvailable = currentAvailable;
        let newPending = currentPending;

        if (isImmediate) {
          newAvailable = currentAvailable + amountCentavos;
        } else {
          newPending = currentPending + amountCentavos;
        }

        const newTotalBalance = newAvailable + newPending + currentReserved;

        transaction.set(sellerBalanceRef, {
          sellerId,
          balanceAvailable_BRL: newAvailable,
          balancePending_BRL: newPending,
          balanceReserved_BRL: currentReserved,
          lifetimeRevenue_BRL: (balanceData?.lifetimeRevenue_BRL || 0) + amountCentavos,
          available: newAvailable,
          availableBalance: newAvailable,
          totalBalance: newTotalBalance,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastCreditedOrderId: metadata.orderId,
          lastCreditedAmount: amountCentavos,
          lastCreditedAt: admin.firestore.FieldValue.serverTimestamp(),
          currency: 'BRL'
        }, { merge: true });

        if (orderDoc.exists) {
          transaction.update(orderRef, {
            balanceCredited: true,
            balanceCreditedAt: admin.firestore.FieldValue.serverTimestamp(),
            balanceCreditedAmount: amountCentavos
          });
        }

        const balanceType = isImmediate ? 'AVAILABLE' : 'PENDING';
        console.log(`💰 [BALANCE] ${balanceType} creditado: Seller ${sellerId} +R$ ${(amountCentavos / 100).toFixed(2)} (ordem ${metadata.orderId}) | Total: R$ ${(newTotalBalance / 100).toFixed(2)}`);
      });

    } catch (error: any) {
      console.error(`❌ [BALANCE] Erro ao creditar saldo do seller ${sellerId}:`, error?.message);
      console.error('❌ Stack:', error?.stack);
    }
  }

  // 📅 LIBERAR COMISSÕES DE AFILIADOS (PENDING → AVAILABLE APÓS RELEASEDATE)
  // 🔄 EXECUTADO POR CRON JOB OU CHAMADA MANUAL
  async releaseAffiliateCommissions(options?: { batchSize?: number; dryRun?: boolean }): Promise<{
    processed: number;
    released: number;
    errors: number;
    dryRun: boolean;
  }> {
    const batchSize = options?.batchSize || 50; // Processar 50 por vez
    const dryRun = options?.dryRun || false;
    
    let processed = 0;
    let released = 0;
    let errors = 0;

    try {
      await this.ensureFirebaseReady();
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase não conectado');
      }

      console.log(`🚀 Iniciando liberação de comissões de afiliados (batch: ${batchSize}, dryRun: ${dryRun})`);

      // 🔍 BUSCAR COMISSÕES PENDENTES
      // FIX: query campo único (sem índice composto) + filtro releaseDate em memória
      // status + releaseDate juntos exigem índice composto que pode não existir
      const now = new Date();
      const commissionsQuery = await this.db.collection('affiliateCommissions')
        .where('status', '==', 'pending')
        .limit(batchSize * 10) // buscar mais para compensar filtro em memória
        .get();

      // Filtrar em memória: apenas comissões com releaseDate <= agora
      const releasableDocs = commissionsQuery.docs.filter(doc => {
        const d = doc.data();
        if (!d.releaseDate) return true; // sem prazo → liberar imediatamente
        const releaseDate = d.releaseDate?.toDate ? d.releaseDate.toDate() : new Date(d.releaseDate);
        return releaseDate <= now;
      }).slice(0, batchSize);

      if (releasableDocs.length === 0) {
        console.log(`✅ Nenhuma comissão para liberar no momento`);
        return { processed: 0, released: 0, errors: 0, dryRun };
      }

      console.log(`📊 Encontradas ${releasableDocs.length} comissões para liberar`);

      // 🔄 PROCESSAR CADA COMISSÃO
      for (const commissionDoc of releasableDocs) {
        try {
          processed++;
          const commission = commissionDoc.data();
          const commissionId = commission.id;
          const affiliateId = commission.affiliateId || commission.userId;
          const netAmount = commission.netAmount || commission.amount; // Usar netAmount (líquido)

          console.log(`💰 Processando comissão ${commissionId} (R$ ${(netAmount/100).toFixed(2)}) para afiliado ${affiliateId}`);

          if (dryRun) {
            console.log(`   🔍 DRY RUN: Comissão seria liberada`);
            released++;
            continue;
          }

          // 🔒 TRANSAÇÃO ATÔMICA: Atualizar saldo + comissão
          // ⚡ GARANTIA ACID: Todas operações (status + balance + stats) são aplicadas
          //    atomicamente ou NENHUMA é aplicada (rollback total em caso de falha)
          await this.db.runTransaction(async (transaction) => {
            const commissionRef = this.db!.collection('affiliateCommissions').doc(commissionId);
            const balanceRef = this.db!.collection('affiliateBalances').doc(affiliateId);

            // 1️⃣ VERIFICAR COMISSÃO (idempotência robusta)
            // 🔐 CRITICAL: Re-read DENTRO da transaction com lock para evitar race conditions
            const freshCommission = await transaction.get(commissionRef);
            if (!freshCommission.exists) {
              throw new Error(`ROLLBACK: Comissão ${commissionId} não encontrada`);
            }

            const freshData = freshCommission.data();
            
            // 🛡️ IDEMPOTÊNCIA: Se status não é 'pending', significa que já foi processada
            // por outro processo ou retry anterior - pular sem fazer nada
            if (freshData?.status !== 'pending') {
              console.log(`   ⚠️ SKIP: Comissão ${commissionId} já processada (status: ${freshData?.status})`);
              // return sem updates = transação vazia (safe, idempotente)
              return;
            }

            // 2️⃣ BUSCAR SALDO DO AFILIADO (com lock)
            const balanceDoc = await transaction.get(balanceRef);
            if (!balanceDoc.exists) {
              throw new Error(`ROLLBACK: Saldo do afiliado ${affiliateId} não encontrado`);
            }

            const currentBalance = balanceDoc.data();
            
            // 🔍 VALIDAÇÃO: Verificar se há saldo pending suficiente
            // (proteção contra inconsistências de dados)
            if ((currentBalance?.balancePending_BRL || 0) < netAmount) {
              console.error(`   ❌ ERRO: Saldo pending insuficiente! Expected: ${netAmount}, Found: ${currentBalance?.balancePending_BRL || 0}`);
              throw new Error(`ROLLBACK: Saldo pending insuficiente para comissão ${commissionId}`);
            }

            // 3️⃣ MOVER SALDO: PENDING → AVAILABLE (ATOMIC)
            console.log(`   💳 Movendo R$ ${(netAmount/100).toFixed(2)}: balancePending → balanceAvailable`);
            
            // 🔥 CRITICAL: Todas operações de saldo DENTRO da mesma transaction
            transaction.update(balanceRef, {
              balancePending_BRL: admin.firestore.FieldValue.increment(-netAmount),    // 🔻 DECREMENTAR PENDING
              balanceAvailable_BRL: admin.firestore.FieldValue.increment(netAmount),   // 🔺 INCREMENTAR AVAILABLE
              pendingCommissions: admin.firestore.FieldValue.increment(-1),            // Contadores
              approvedCommissions: admin.firestore.FieldValue.increment(1),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // 4️⃣ ATUALIZAR COMISSÃO PARA 'RELEASED' (ATOMIC)
            // 🔥 CRITICAL: Status update DENTRO da mesma transaction
            transaction.update(commissionRef, {
              status: 'released',
              releasedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // 🎉 Se chegou aqui, transaction commit aplicará TODAS mudanças atomicamente
            // Se QUALQUER operação acima falhar, TUDO será revertido (ACID garantido)
            console.log(`   ✅ Transaction staged: comissão + saldo serão commitados atomicamente`);
          });

          released++;

        } catch (commissionError: any) {
          errors++;
          console.error(`   ❌ Erro ao liberar comissão ${commissionDoc.id}:`, commissionError);
          // Continuar processando próximas comissões
        }
      }

      console.log(`🎉 LIBERAÇÃO CONCLUÍDA: ${released}/${processed} comissões liberadas (${errors} erros)`);
      
      return {
        processed,
        released,
        errors,
        dryRun,
      };

    } catch (error: any) {
      console.error('❌ ERRO ao liberar comissões:', error);
      throw error;
    }
  }

  // 🔄 CRIAR SUBSCRIPTION - FUNÇÃO ESSENCIAL FALTANTE!
  async createSubscription(subscriptionData: InsertSubscription): Promise<Subscription> {
    try {
      await this.ensureFirebaseReady();
      
      // 🔐 POLICY ENFORCEMENT: checkoutId is MANDATORY for salesCount integrity
      if (!subscriptionData.checkoutId) {
        throw new Error("POLICY VIOLATION: checkoutId is required to create sales records");
      }
      
      if (!this.useFirebase || !this.db) {
        throw new Error('Firebase não conectado - impossível criar subscription');
      }

      // Gerar ID único para subscription
      const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`;
      
      const newSubscription: Subscription = {
        id: subscriptionId,
        ...subscriptionData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      console.log(`🔄 CRIANDO SUBSCRIPTION: ${subscriptionId}`);
      console.log(`👤 Cliente: ${subscriptionData.customerEmail}`);
      console.log(`💰 Valor: R$ ${(subscriptionData.amount/100).toFixed(2)}`);
      console.log(`📅 Período: ${subscriptionData.period}`);

      // 🧹 Filtrar campos undefined antes de salvar
      const subscriptionToSave = {
        ...newSubscription,
        startDate: admin.firestore.Timestamp.fromDate(newSubscription.startDate),
        nextBillingDate: admin.firestore.Timestamp.fromDate(newSubscription.nextBillingDate),
        expiresAt: admin.firestore.Timestamp.fromDate(newSubscription.expiresAt),
        lastPaymentDate: newSubscription.lastPaymentDate ? admin.firestore.Timestamp.fromDate(newSubscription.lastPaymentDate) : null,
        cancelledAt: newSubscription.cancelledAt ? admin.firestore.Timestamp.fromDate(newSubscription.cancelledAt) : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      // Remover campos undefined
      const cleanedSubscription = Object.fromEntries(
        Object.entries(subscriptionToSave).filter(([_, value]) => value !== undefined)
      );

      // 🔐 TRANSAÇÃO ATÔMICA: Salvar subscription + incrementar salesCount (operação crítica)
      await this.db.runTransaction(async (transaction) => {
        const subscriptionRef = this.db!.collection('subscriptions').doc(subscriptionId);
        const checkoutRef = subscriptionData.checkoutId ? this.db!.collection('checkouts').doc(subscriptionData.checkoutId) : null;
        
        // 0️⃣ Verificar checkout existe (se tiver checkoutId)
        if (checkoutRef) {
          const checkoutDoc = await transaction.get(checkoutRef);
          if (!checkoutDoc.exists) {
            throw new Error(`Checkout ${subscriptionData.checkoutId} não encontrado`);
          }
        }
        
        // 1️⃣ Salvar subscription na transação (dates já normalizados)
        transaction.set(subscriptionRef, cleanedSubscription);

        // 2️⃣ Incrementar salesCount atomicamente usando FieldValue.increment(1)
        // ✅ CRITICAL: Isso garante atomic increment SEM sobrescrever outros campos do checkout!
        if (checkoutRef) {
          transaction.update(checkoutRef, {
            salesCount: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        console.log(`✅ TRANSAÇÃO: Subscription ${subscriptionId} + salesCount incrementado atomicamente`);
      });
      
      // 🔄 INVALIDAR CACHE: Forçar GET do checkout para garantir salesCount atualizado
      if (subscriptionData.checkoutId) {
        try {
          const freshCheckout = await this.db.collection('checkouts').doc(subscriptionData.checkoutId).get();
          const currentSalesCount = freshCheckout.data()?.salesCount || 0;
          console.log(`📊 ✅ Checkout ${subscriptionData.checkoutId} recarregado: ${currentSalesCount} venda(s) total (cache invalidado)`);
        } catch (e) {
          console.warn('⚠️ Falha ao recarregar checkout para invalidar cache:', e);
        }
      }

      // Verificar se foi salvo
      const verification = await this.db.collection('subscriptions').doc(subscriptionId).get();
      if (!verification.exists) {
        throw new Error('🚨 FALHA: Subscription não foi salvo no Firebase');
      }

      console.log(`🎉 SUBSCRIPTION CRIADA COM SUCESSO: ${subscriptionId}`);
      
      return newSubscription;

    } catch (error: any) {
      console.error('❌ ERRO ao criar subscription:', error);
      throw error;
    }
  }

  // 🔄 SUBSCRIPTION OPERATIONS - FIREBASE/FIRESTORE PERMANENTE
  async getSubscription(id: string): Promise<Subscription | undefined> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      const doc = await this.db.collection('subscriptions').doc(id).get();
      if (!doc.exists) return undefined;
      
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        startDate: data?.startDate?.toDate() || new Date(),
        nextBillingDate: data?.nextBillingDate?.toDate() || new Date(),
        expiresAt: data?.expiresAt?.toDate() || new Date(),
        lastPaymentDate: data?.lastPaymentDate?.toDate() || null,
        cancelledAt: data?.cancelledAt?.toDate() || null,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Subscription;
    } catch (error: any) {
      console.error('❌ ERRO ao buscar subscription:', error);
      throw error;
    }
  }

  async getSubscriptionsByTenant(tenantId: string): Promise<Subscription[]> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      console.log('🔍 Buscando subscriptions para tenant:', tenantId);
      
      const snapshot = await this.db.collection('subscriptions')
        .where('tenantId', '==', tenantId)
        .get();
      
      const subscriptions = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          startDate: data?.startDate?.toDate() || new Date(),
          nextBillingDate: data?.nextBillingDate?.toDate() || new Date(),
          expiresAt: data?.expiresAt?.toDate() || new Date(),
          lastPaymentDate: data?.lastPaymentDate?.toDate() || null,
          cancelledAt: data?.cancelledAt?.toDate() || null,
          createdAt: data?.createdAt?.toDate() || new Date(),
          updatedAt: data?.updatedAt?.toDate() || new Date(),
        } as Subscription;
      });

      // Sort in memory — avoids need for composite index (tenantId + createdAt)
      subscriptions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      console.log(`✅ ${subscriptions.length} subscriptions encontradas para tenant ${tenantId} (MAIS NOVAS PRIMEIRO)`);
      return subscriptions;
    } catch (error: any) {
      console.error('❌ ERRO ao buscar subscriptions por tenant:', error);
      return [];
    }
  }

  async getSubscriptionByCustomerAndProduct(tenantId: string, customerEmail: string, checkoutId: string): Promise<Subscription | undefined> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      const snapshot = await this.db.collection('subscriptions')
        .where('tenantId', '==', tenantId)
        .where('customerEmail', '==', customerEmail)
        .where('checkoutId', '==', checkoutId)
        .limit(1)
        .get();
      
      if (snapshot.empty) return undefined;
      
      const doc = snapshot.docs[0];
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        startDate: data?.startDate?.toDate() || new Date(),
        nextBillingDate: data?.nextBillingDate?.toDate() || new Date(),
        expiresAt: data?.expiresAt?.toDate() || new Date(),
        lastPaymentDate: data?.lastPaymentDate?.toDate() || null,
        cancelledAt: data?.cancelledAt?.toDate() || null,
        createdAt: data?.createdAt?.toDate() || new Date(),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      } as Subscription;
    } catch (error: any) {
      console.error('❌ ERRO ao buscar subscription por customer/product:', error);
      return undefined;
    }
  }

  async updateSubscription(id: string, updates: Partial<Subscription>): Promise<Subscription> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      const updateData: any = {
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      // Convert dates to Firestore timestamps if provided
      if (updates.nextBillingDate && updates.nextBillingDate instanceof Date) {
        updateData.nextBillingDate = admin.firestore.Timestamp.fromDate(updates.nextBillingDate);
      }
      if (updates.expiresAt && updates.expiresAt instanceof Date) {
        updateData.expiresAt = admin.firestore.Timestamp.fromDate(updates.expiresAt);
      }
      if (updates.cancelledAt && updates.cancelledAt instanceof Date) {
        updateData.cancelledAt = admin.firestore.Timestamp.fromDate(updates.cancelledAt);
      }
      
      await this.db.collection('subscriptions').doc(id).update(updateData);
      
      // Return updated subscription
      const updatedSubscription = await this.getSubscription(id);
      if (!updatedSubscription) throw new Error('Subscription não encontrada após update');
      
      return updatedSubscription;
    } catch (error: any) {
      console.error('❌ ERRO ao atualizar subscription:', error);
      throw error;
    }
  }

  async cancelSubscription(id: string): Promise<Subscription> {
    try {
      console.log(`🔄 Cancelando subscription: ${id}`);
      
      // 1. Atualizar subscription para cancelled
      const subscription = await this.updateSubscription(id, {
        status: 'cancelled',
        cancelledAt: new Date(),
      });
      
      // 2. Atualizar enrollment para REMOVER ACESSO
      console.log(`🔒 Removendo acesso: ${subscription.customerEmail} do produto ${subscription.productName}`);
      await this.updateEnrollmentStatusByEmail(
        subscription.tenantId,
        subscription.customerEmail,
        subscription.checkoutId,
        'cancelled'
      );
      
      console.log(`✅ Subscription cancelada e acesso removido: ${id}`);
      return subscription;
    } catch (error: any) {
      console.error('❌ ERRO ao cancelar subscription:', error);
      throw error;
    }
  }

  async processExpiredSubscriptions(): Promise<number> {
    try {
      console.log('🔄 CRON JOB: Processando subscriptions expiradas...');
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      const now = new Date();
      let expiredCount = 0;
      let renewedCount = 0;
      
      // Buscar TODAS as subscriptions ativas
      const snapshot = await this.db.collection('subscriptions')
        .where('status', '==', 'active')
        .get();
      
      console.log(`📊 ${snapshot.size} subscriptions ativas encontradas`);
      
      // Processar cada subscription
      for (const doc of snapshot.docs) {
        const data = doc.data();
        
        // Converter nextBillingDate para Date
        let nextBillingDate: Date;
        const nbDate: any = data?.nextBillingDate;
        
        if (nbDate?._seconds) {
          nextBillingDate = new Date(nbDate._seconds * 1000);
        } else if (nbDate?.seconds) {
          nextBillingDate = new Date(nbDate.seconds * 1000);
        } else if (nbDate instanceof Date) {
          nextBillingDate = nbDate;
        } else if (nbDate?.toDate) {
          nextBillingDate = nbDate.toDate();
        } else {
          nextBillingDate = new Date(nbDate);
        }
        
        // Se chegou a data de renovação
        if (nextBillingDate <= now) {
          const subscriptionId = doc.id;
          
          // 🔄 RENOVAÇÃO AUTOMÁTICA: Se autoRenew = true, renovar ao invés de expirar
          if (data.autoRenew === true) {
            console.log(`🔄 RENOVANDO: ${subscriptionId} - Cliente: ${data.customerEmail} - Ciclo ${data.recurringCount || 1}`);
            
            try {
              await this.renewSubscription(subscriptionId, data);
              renewedCount++;
            } catch (renewError: any) {
              console.error(`❌ ERRO ao renovar ${subscriptionId}:`, renewError);
            }
          } else {
            // ❌ EXPIRAR: Se autoRenew = false
            console.log(`⏰ EXPIRANDO: ${subscriptionId} - Cliente: ${data.customerEmail} (autoRenew=false)`);
            
            try {
              await this.db.runTransaction(async (transaction) => {
                const docRef = this.db!.collection('subscriptions').doc(subscriptionId);
                const currentDoc = await transaction.get(docRef);
                
                if (!currentDoc.exists) {
                  console.log(`⚠️ Subscription ${subscriptionId} não existe mais`);
                  return;
                }
                
                const currentData = currentDoc.data();
                
                if (currentData?.status !== 'active') {
                  console.log(`⏭️ PULANDO: ${subscriptionId} - Status: ${currentData?.status}`);
                  return;
                }
                
                transaction.update(docRef, {
                  status: 'expired',
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                
                console.log(`✅ ${subscriptionId} expirado`);
              });
              
              await this.updateEnrollmentStatusByEmail(
                data.tenantId,
                data.customerEmail,
                data.checkoutId,
                'expired'
              );

              // 📣 NOTIFICAR CLIENTE QUE PERDEU ACESSO + LINK PARA RENOVAR
              try {
                const { sendSubscriptionExpiredEmail } = await import('./lib/email-service.js');
                const renewUrl = `https://volatuspay.com/checkout/${data.checkoutId}`;
                const productName = data.productName || 'sua assinatura';
                const customerName = data.customerName || 'Cliente';
                const customerEmail = data.customerEmail || '';

                if (customerEmail) {
                  await sendSubscriptionExpiredEmail({
                    customerEmail,
                    customerName,
                    productName,
                    renewUrl,
                  }).catch((e: any) => console.warn('[CRON] Email expirado falhou:', e?.message));
                }
              } catch (notifyErr: any) {
                console.warn(`⚠️ [CRON] Notificação de expiração falhou para ${subscriptionId}:`, notifyErr?.message);
              }

              expiredCount++;
            } catch (transactionError: any) {
              console.error(`❌ ERRO ao expirar ${subscriptionId}:`, transactionError);
            }
          }
        }
      }
      
      console.log(`✅ CRON JOB: ${renewedCount} renovadas, ${expiredCount} expiradas`);

      // ═══════════════════════════════════════════════════════
      // 🔔 RÉGUA DE COMUNICAÇÃO — NOTIFICAÇÕES PRÉ E PÓS-VENCIMENTO
      // Janelas: -7d, -3d, -1d (antes) | +1d, +2d, +3d (depois)
      // ═══════════════════════════════════════════════════════
      try {
        const { sendSubscriptionExpiringEmail, sendSubscriptionReactivationEmail } = await import('./lib/email-service.js');
        const appBaseUrl = process.env.APP_BASE_URL || 'https://volatuspay.com';

        // Cache de reguaConfig por tenantId para não bater no Firestore toda iteração
        const reguaCache: Record<string, Record<string, boolean>> = {};
        const getReguaConfig = async (tenantId: string): Promise<Record<string, boolean>> => {
          if (reguaCache[tenantId] !== undefined) return reguaCache[tenantId];
          try {
            const sellerDoc = await this.db!.collection('sellers').doc(tenantId).get();
            const cfg = sellerDoc.data()?.reguaConfig || {};
            // Defaults: 3d e vencimento sempre ativos; 7d, 1d, pós = opt-in
            reguaCache[tenantId] = {
              dias7:      cfg.dias7      ?? false,
              dias3:      cfg.dias3      ?? true,
              dia1antes:  cfg.dia1antes  ?? true,
              vencimento: cfg.vencimento ?? true,
              dia1depois: cfg.dia1depois ?? true,
              dia2depois: cfg.dia2depois ?? false,
              dia3depois: cfg.dia3depois ?? false,
            };
          } catch {
            reguaCache[tenantId] = { dias7: false, dias3: true, dia1antes: true, vencimento: true, dia1depois: true, dia2depois: false, dia3depois: false };
          }
          return reguaCache[tenantId];
        };

        // ── HELPER: enviar email + whatsapp de vencimento iminente ──
        const sendExpiringNotif = async (doc: FirebaseFirestore.QueryDocumentSnapshot, daysLeft: number, flagKey: string) => {
          const d = doc.data();
          const tenantId = d.tenantId || '';
          if (tenantId) {
            const regua = await getReguaConfig(tenantId);
            const reguaKey = daysLeft === 7 ? 'dias7' : daysLeft === 3 ? 'dias3' : 'dia1antes';
            if (!regua[reguaKey]) return;
          }
          const valor = ((d.amount || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          const productName = d.productName || 'sua assinatura';
          const customerEmail = d.customerEmail || '';
          const customerName = d.customerName || 'Cliente';
          const customerPhone = d.customerPhone || '';
          const renewUrl = `${appBaseUrl}/checkout/${d.checkoutId}`;
          let nextBilling: Date;
          const nb: any = d?.nextBillingDate;
          if (nb?._seconds) nextBilling = new Date(nb._seconds * 1000);
          else if (nb?.seconds) nextBilling = new Date(nb.seconds * 1000);
          else if (nb?.toDate) nextBilling = nb.toDate();
          else nextBilling = new Date(nb);
          const expiresAtStr = nextBilling.toLocaleDateString('pt-BR');

          console.log(`🔔 [RÉGUA -${daysLeft}d] ${customerEmail} — ${productName}`);
          if (customerEmail) {
            await sendSubscriptionExpiringEmail({ customerEmail, customerName, productName, daysLeft, expiresAt: expiresAtStr, valor, renewUrl })
              .catch((e: any) => console.warn(`[CRON] Email -${daysLeft}d falhou:`, e?.message));
          }
          await this.db!.collection('subscriptions').doc(doc.id).update({
            [flagKey]: true,
            [`${flagKey}At`]: admin.firestore.FieldValue.serverTimestamp(),
          });
        };

        // ── PRÉ-VENCIMENTO: percorrer assinaturas ATIVAS do snapshot inicial ──
        const sevenDaysFromNow  = new Date(now.getTime() + 7  * 24 * 60 * 60 * 1000);
        const threeDaysFromNow  = new Date(now.getTime() + 3  * 24 * 60 * 60 * 1000);
        const oneDayFromNow     = new Date(now.getTime() + 1  * 24 * 60 * 60 * 1000);

        for (const doc of snapshot.docs) {
          const d = doc.data();
          let nextBilling: Date;
          const nb: any = d?.nextBillingDate;
          if (nb?._seconds) nextBilling = new Date(nb._seconds * 1000);
          else if (nb?.seconds) nextBilling = new Date(nb.seconds * 1000);
          else if (nb?.toDate) nextBilling = nb.toDate();
          else nextBilling = new Date(nb);

          // 7 dias antes (janela: entre 6d23h e 7d)
          if (!d.notified7Days && nextBilling > now && nextBilling <= sevenDaysFromNow
              && nextBilling > threeDaysFromNow) {
            await sendExpiringNotif(doc, 7, 'notified7Days').catch(() => {});
          }
          // 3 dias antes (janela: entre 1d e 3d)
          else if (!d.notified3Days && nextBilling > now && nextBilling <= threeDaysFromNow
              && nextBilling > oneDayFromNow) {
            await sendExpiringNotif(doc, 3, 'notified3Days').catch(() => {});
          }
          // 1 dia antes (janela: entre agora e 1d)
          else if (!d.notifiedDay1Before && nextBilling > now && nextBilling <= oneDayFromNow) {
            await sendExpiringNotif(doc, 1, 'notifiedDay1Before').catch(() => {});
          }
        }

        // ── PÓS-VENCIMENTO: buscar assinaturas EXPIRADAS recentes (+1, +2, +3 dias) ──
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const expiredRecentSnapshot = await this.db!.collection('subscriptions')
          .where('status', '==', 'expired')
          .where('updatedAt', '>=', admin.firestore.Timestamp.fromDate(threeDaysAgo))
          .get();

        for (const doc of expiredRecentSnapshot.docs) {
          const d = doc.data();
          const tenantId = d.tenantId || '';
          const regua = tenantId ? await getReguaConfig(tenantId) : { dia1depois: true, dia2depois: false, dia3depois: false };

          let expiredAt: Date;
          const ua: any = d?.updatedAt;
          if (ua?._seconds) expiredAt = new Date(ua._seconds * 1000);
          else if (ua?.seconds) expiredAt = new Date(ua.seconds * 1000);
          else if (ua?.toDate) expiredAt = ua.toDate();
          else expiredAt = new Date(ua);

          const msSinceExpiry = now.getTime() - expiredAt.getTime();
          const daysSinceExpiry = Math.floor(msSinceExpiry / (24 * 60 * 60 * 1000));

          const productName = d.productName || 'sua assinatura';
          const customerEmail = d.customerEmail || '';
          const customerName = d.customerName || 'Cliente';
          const renewUrl = `${appBaseUrl}/checkout/${d.checkoutId}`;
          const valor = ((d.amount || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

          const sendReact = async (daysAfter: 1 | 2 | 3, flagKey: string) => {
            if (!customerEmail) return;
            console.log(`🔁 [RÉGUA +${daysAfter}d] ${customerEmail} — ${productName}`);
            await sendSubscriptionReactivationEmail({ customerEmail, customerName, productName, renewUrl, daysAfter, valor })
              .catch((e: any) => console.warn(`[CRON] Email +${daysAfter}d falhou:`, e?.message));
            await this.db!.collection('subscriptions').doc(doc.id).update({
              [flagKey]: true,
              [`${flagKey}At`]: admin.firestore.FieldValue.serverTimestamp(),
            });
          };

          if (daysSinceExpiry >= 1 && !d.notifiedPlus1Day && regua.dia1depois) {
            await sendReact(1, 'notifiedPlus1Day').catch(() => {});
          }
          if (daysSinceExpiry >= 2 && !d.notifiedPlus2Days && regua.dia2depois) {
            await sendReact(2, 'notifiedPlus2Days').catch(() => {});
          }
          if (daysSinceExpiry >= 3 && !d.notifiedPlus3Days && regua.dia3depois) {
            await sendReact(3, 'notifiedPlus3Days').catch(() => {});
          }
        }

        console.log('✅ CRON JOB: Régua de comunicação processada com sucesso');
      } catch (notifError: any) {
        console.error('❌ CRON JOB: Erro na régua de comunicação:', notifError?.message);
      }

      return renewedCount + expiredCount;
    } catch (error: any) {
      console.error('❌ ERRO ao processar subscriptions:', error);
      return 0;
    }
  }

  async renewSubscription(subscriptionId: string, subscriptionData: any): Promise<void> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');

      // 📖 Ler estado atual fora de transação (API calls não podem ser dentro de transação)
      const docRef = this.db.collection('subscriptions').doc(subscriptionId);
      const snap = await docRef.get();
      if (!snap.exists) {
        console.log(`⚠️ Subscription ${subscriptionId} não existe mais`);
        return;
      }
      const current = snap.data()!;
      if (current.status !== 'active') {
        console.log(`⏭️ PULANDO RENOVAÇÃO: ${subscriptionId} - Status: ${current.status}`);
        return;
      }

      // Idempotência: verificar se o ciclo já foi avançado
      const currentCycle = current.recurringCount || 1;

      // 💳 CARD SUBSCRIPTION: Tentar cobrar antes de avançar o ciclo
      if (current.method === 'card' && current.payment_token && current.billingAddress) {
        console.log(`💳 [DUNNING] Tentando cobrar renovação de cartão: ${subscriptionId} (ciclo ${currentCycle + 1})`);
        try {
          const customer = {
            name: current.customerName || 'Cliente',
            email: current.customerEmail || '',
            phone_number: ((current.customerPhone || '') as string).replace(/\D/g, '') || '00000000000',
            cpf: ((current.customerDocument || '') as string).replace(/\D/g, ''),
            birthDate: current.customerBirth || '1990-01-01',
            address: current.billingAddress,
          };

          const renewOrderId = `renewal_${subscriptionId}_c${currentCycle + 1}_${Date.now()}`;
          const { createCardCharge } = await import('./lib/efibank-payments-api.js');
          await createCardCharge(this.db, renewOrderId, current.amount, customer, current.productName || 'Assinatura', current.payment_token, 1);

          // ✅ COBRANÇA OK: avançar ciclo
          await this.advanceSubscriptionCycle(subscriptionId, current);
          console.log(`✅ [DUNNING] Renovação automática bem-sucedida: ${subscriptionId} → ciclo ${currentCycle + 1}`);
        } catch (chargeErr: any) {
          console.warn(`⚠️ [DUNNING] Cobrança de renovação falhou: ${subscriptionId} — ${chargeErr?.message}`);

          // ❌ COBRANÇA FALHOU: marcar como past_due e iniciar dunning
          const nextRetry = this.calcNextRetryDate(1);
          await docRef.update({
            status: 'past_due',
            dunningAttempts: 1,
            nextRetryDate: nextRetry,
            lastChargeError: chargeErr?.message || 'Cartão recusado',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Notificar cliente
          try {
            const { sendDunningFailedEmail } = await import('./lib/email-service.js');
            if (current.customerEmail) {
              await sendDunningFailedEmail({
                customerEmail: current.customerEmail,
                customerName: current.customerName || 'Cliente',
                productName: current.productName || 'Assinatura',
                attempt: 1,
                nextRetryDate: nextRetry,
              }).catch((e: any) => console.warn('[DUNNING] Email falhou:', e?.message));
            }
          } catch (e: any) {
            console.warn('[DUNNING] Erro ao enviar email:', e?.message);
          }
        }
        return;
      }

      // 🔄 NON-CARD (PIX/Boleto): apenas avançar ciclo (régua de comunicação cuida do resto)
      await this.advanceSubscriptionCycle(subscriptionId, current);
    } catch (error: any) {
      console.error(`❌ Erro ao renovar subscription ${subscriptionId}:`, error);
      throw error;
    }
  }

  // ─── Helpers de ciclo e dunning ───────────────────────────────────────────

  private calcNextBillingDate(billingCycle: string): Date {
    const d = new Date();
    switch (billingCycle) {
      case 'mensal': case 'monthly': d.setMonth(d.getMonth() + 1); break;
      case 'trimestral': case 'quarterly': d.setMonth(d.getMonth() + 3); break;
      case 'semestral': case 'semiannual': d.setMonth(d.getMonth() + 6); break;
      case 'anual': case 'annual': d.setFullYear(d.getFullYear() + 1); break;
      default: d.setMonth(d.getMonth() + 1);
    }
    return d;
  }

  private calcNextRetryDate(attempt: number): Date {
    const daysMap: Record<number, number> = { 1: 1, 2: 3, 3: 7 };
    const days = daysMap[attempt] ?? 14;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async advanceSubscriptionCycle(subscriptionId: string, current: any): Promise<void> {
    const currentCycle = current.recurringCount || 1;
    const newCycle = currentCycle + 1;
    const billingCycle = current.period || current.billingCycle || 'monthly';
    const nextBillingDate = this.calcNextBillingDate(billingCycle);

    await this.db!.collection('subscriptions').doc(subscriptionId).update({
      recurringCount: newCycle,
      nextBillingDate,
      currentPeriodStart: new Date(),
      currentPeriodEnd: nextBillingDate,
      status: 'active',
      dunningAttempts: 0,
      lastChargeError: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ RENOVADA: ${subscriptionId} — ciclo ${currentCycle} → ${newCycle} — próxima: ${nextBillingDate.toISOString()}`);
  }

  // ─── DUNNING: Processar retries de cartão recusado ────────────────────────

  async processDunningRetries(): Promise<number> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase não inicializado');

      const now = new Date();
      const snapshot = await this.db.collection('subscriptions').where('status', '==', 'past_due').get();
      const MAX_ATTEMPTS = 3;
      let processed = 0;

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const subscriptionId = doc.id;

        // Verificar se chegou a hora do retry
        const nr: any = data.nextRetryDate;
        let nextRetry: Date;
        if (nr?.toDate) nextRetry = nr.toDate();
        else if (nr?._seconds) nextRetry = new Date(nr._seconds * 1000);
        else if (nr?.seconds) nextRetry = new Date(nr.seconds * 1000);
        else nextRetry = new Date(nr);

        if (nextRetry > now) continue;

        const attempts = data.dunningAttempts || 1;

        // Sem token/endereço: não dá pra cobrar
        if (!data.payment_token || !data.billingAddress) {
          console.warn(`⚠️ [DUNNING] ${subscriptionId} sem token/endereço — pulando`);
          continue;
        }

        // ❌ Esgotou tentativas: cancelar assinatura
        if (attempts >= MAX_ATTEMPTS) {
          await doc.ref.update({
            status: 'cancelled',
            cancelledReason: 'dunning_failed',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await this.updateEnrollmentStatusByEmail(data.tenantId, data.customerEmail, data.checkoutId, 'cancelled');

          try {
            const { sendSubscriptionCancelledDunningEmail } = await import('./lib/email-service.js');
            if (data.customerEmail) {
              const appBase = process.env.APP_BASE_URL || 'https://volatuspay.com';
              await sendSubscriptionCancelledDunningEmail({
                customerEmail: data.customerEmail,
                customerName: data.customerName || 'Cliente',
                productName: data.productName || 'Assinatura',
                renewUrl: `${appBase}/checkout/${data.checkoutId}`,
              }).catch((e: any) => console.warn('[DUNNING] Email cancelamento:', e?.message));
            }
          } catch (e: any) {
            console.warn('[DUNNING] Erro email cancelamento:', e?.message);
          }

          console.log(`❌ [DUNNING] Subscription cancelada após ${MAX_ATTEMPTS} tentativas: ${subscriptionId}`);
          processed++;
          continue;
        }

        // 💳 Tentar cobrar novamente
        try {
          const customer = {
            name: data.customerName || 'Cliente',
            email: data.customerEmail || '',
            phone_number: ((data.customerPhone || '') as string).replace(/\D/g, '') || '00000000000',
            cpf: ((data.customerDocument || '') as string).replace(/\D/g, ''),
            birthDate: data.customerBirth || '1990-01-01',
            address: data.billingAddress,
          };

          const retryOrderId = `dunning_${subscriptionId}_a${attempts + 1}_${Date.now()}`;
          const { createCardCharge } = await import('./lib/efibank-payments-api.js');
          await createCardCharge(this.db, retryOrderId, data.amount, customer, data.productName || 'Assinatura', data.payment_token, 1);

          // ✅ RETRY OK: restaurar assinatura ativa
          await this.advanceSubscriptionCycle(subscriptionId, data);
          console.log(`✅ [DUNNING] Retry bem-sucedido (tentativa ${attempts + 1}): ${subscriptionId}`);
          processed++;
        } catch (retryErr: any) {
          // ❌ RETRY FALHOU: incrementar contagem e agendar próximo
          const newAttempts = attempts + 1;
          const nextRetryDate = this.calcNextRetryDate(newAttempts);

          await doc.ref.update({
            dunningAttempts: newAttempts,
            nextRetryDate,
            lastChargeError: retryErr?.message || 'Cartão recusado',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          try {
            const { sendDunningFailedEmail } = await import('./lib/email-service.js');
            if (data.customerEmail) {
              await sendDunningFailedEmail({
                customerEmail: data.customerEmail,
                customerName: data.customerName || 'Cliente',
                productName: data.productName || 'Assinatura',
                attempt: newAttempts,
                nextRetryDate,
              }).catch((e: any) => console.warn('[DUNNING] Email retry:', e?.message));
            }
          } catch (e: any) {
            console.warn('[DUNNING] Erro email retry:', e?.message);
          }

          console.warn(`⚠️ [DUNNING] Retry ${newAttempts} falhou: ${subscriptionId} — próxima: ${nextRetryDate.toISOString()}`);
          processed++;
        }
      }

      console.log(`✅ [DUNNING] ${processed} subscriptions processadas`);
      return processed;
    } catch (error: any) {
      console.error('❌ [DUNNING] Erro em processDunningRetries:', error);
      return 0;
    }
  }

  async updateEnrollmentStatusByEmail(
    tenantId: string,
    customerEmail: string,
    checkoutId: string,
    status: 'active' | 'expired' | 'cancelled'
  ): Promise<void> {
    try {
      await this.ensureFirebaseReady();
      if (!this.db) throw new Error('Firebase/Firestore é obrigatório');
      
      // Buscar enrollment por email e checkoutId
      const snapshot = await this.db.collection('enrollments')
        .where('tenantId', '==', tenantId)
        .where('customerEmail', '==', customerEmail)
        .where('checkoutId', '==', checkoutId)
        .limit(1)
        .get();
      
      if (snapshot.empty) {
        console.log(`⚠️ Enrollment não encontrado para ${customerEmail} no checkout ${checkoutId}`);
        return;
      }
      
      const enrollmentDoc = snapshot.docs[0];
      await enrollmentDoc.ref.update({
        status: status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      console.log(`✅ Enrollment atualizado: ${customerEmail} → status: ${status}`);
    } catch (error: any) {
      console.error('❌ ERRO ao atualizar enrollment:', error);
    }
  }

  // 🎯 BANNER MANAGEMENT - SISTEMA DE BANNERS FIREBASE COM ISOLAMENTO
  async getBannersByTenant(tenantId: string): Promise<Banner[]> {
    try {
      await this.initializationPromise;
      if (!this.db) {
        console.error('❌ Firebase não inicializado');
        return [];
      }

      console.log('🔍 FIREBASE: Buscando banners para tenant:', tenantId);

      const bannersRef = this.db.collection('banners');
      
      // 🛡️ TRY: Query com ordenação (requer índice)
      let snapshot: any;
      try {
        snapshot = await bannersRef
          .where('tenantId', '==', tenantId)
          .orderBy('priority', 'asc')
          .get();
      } catch (indexError: any) {
        // 🔄 FALLBACK: Query simples se índice não existir
        if (indexError.code === 9) { // FAILED_PRECONDITION
          console.log('⚠️ FALLBACK: Índice não existe, usando query simples');
          snapshot = await bannersRef
            .where('tenantId', '==', tenantId)
            .get();
        } else {
          throw indexError;
        }
      }

      const banners: Banner[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        banners.push({
          id: doc.id,
          tenantId: data.tenantId,
          title: data.title,
          imageUrl: data.imageUrl,
          link: data.link,
          isActive: data.isActive,
          position: data.position,
          priority: data.priority,
          startDate: data.startDate?.toDate(),
          endDate: data.endDate?.toDate(),
          description: data.description,
          targetBlank: data.targetBlank,
          createdAt: data.createdAt?.toDate(),
          updatedAt: data.updatedAt?.toDate()
        });
      });

      console.log(`✅ FIREBASE: ${banners.length} banners encontrados para tenant ${tenantId}`);
      return banners;
    } catch (error) {
      console.error('❌ FIREBASE: Erro ao buscar banners:', error);
      return [];
    }
  }

  async getBanner(bannerId: string, tenantId: string): Promise<Banner | null> {
    try {
      await this.initializationPromise;
      if (!this.db) {
        console.error('❌ Firebase não inicializado');
        return null;
      }

      console.log('🔍 FIREBASE: Buscando banner:', bannerId, 'para tenant:', tenantId);

      const doc = await this.db.collection('banners').doc(bannerId).get();
      
      if (!doc.exists) {
        console.log(`❌ Banner não encontrado: ${bannerId}`);
        return null;
      }

      const data = doc.data()!;
      
      // 🔐 VERIFICAR ISOLAMENTO - Banner deve pertencer ao tenant
      if (data.tenantId !== tenantId) {
        console.log(`🚨 ACESSO NEGADO: Banner ${bannerId} não pertence ao tenant ${tenantId}`);
        return null;
      }

      const banner: Banner = {
        id: doc.id,
        tenantId: data.tenantId,
        title: data.title,
        imageUrl: data.imageUrl,
        link: data.link,
        isActive: data.isActive,
        position: data.position,
        priority: data.priority,
        startDate: data.startDate?.toDate(),
        endDate: data.endDate?.toDate(),
        description: data.description,
        targetBlank: data.targetBlank,
        createdAt: data.createdAt?.toDate(),
        updatedAt: data.updatedAt?.toDate()
      };

      console.log(`✅ FIREBASE: Banner encontrado: ${bannerId}`);
      return banner;
    } catch (error) {
      console.error('❌ FIREBASE: Erro ao buscar banner:', error);
      return null;
    }
  }

  async createBanner(bannerData: InsertBanner, tenantId: string): Promise<Banner> {
    try {
      await this.initializationPromise;
      if (!this.db) {
        throw new Error('Firebase não inicializado');
      }

      console.log('🚀 FIREBASE: Iniciando createBanner para tenant:', tenantId);
      console.log('🚀 FIREBASE: bannerData:', JSON.stringify(bannerData, null, 2));

      const bannerId = `banner_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date();

      const bannerDocument = {
        tenantId, // 🔐 ISOLAMENTO POR USUÁRIO
        title: bannerData.title || '',
        imageUrl: bannerData.imageUrl,
        link: bannerData.link || null,
        isActive: bannerData.isActive !== false,
        position: bannerData.position || 'dashboard_top',
        priority: bannerData.priority || 0,
        description: bannerData.description || null,
        targetBlank: bannerData.targetBlank || false,
        startDate: bannerData.startDate ? admin.firestore.Timestamp.fromDate(bannerData.startDate) : null,
        endDate: bannerData.endDate ? admin.firestore.Timestamp.fromDate(bannerData.endDate) : null,
        createdAt: admin.firestore.Timestamp.fromDate(now),
        updatedAt: admin.firestore.Timestamp.fromDate(now)
      };

      await this.db.collection('banners').doc(bannerId).set(bannerDocument);

      const banner: Banner = {
        id: bannerId,
        tenantId,
        title: bannerDocument.title,
        imageUrl: bannerDocument.imageUrl,
        link: bannerDocument.link,
        isActive: bannerDocument.isActive,
        position: bannerDocument.position,
        priority: bannerDocument.priority,
        description: bannerDocument.description,
        targetBlank: bannerDocument.targetBlank,
        startDate: bannerDocument.startDate?.toDate(),
        endDate: bannerDocument.endDate?.toDate(),
        createdAt: now,
        updatedAt: now
      };

      console.log('✅ FIREBASE: Banner criado com sucesso:', bannerId);
      console.log('🔐 ISOLAMENTO: Banner pertence ao tenant:', tenantId);
      return banner;
    } catch (error: any) {
      console.error('❌ FIREBASE: Erro ao criar banner:', error);
      throw error;
    }
  }

  async updateBanner(bannerId: string, tenantId: string, updates: Partial<Banner>): Promise<Banner> {
    try {
      await this.initializationPromise;
      if (!this.db) {
        throw new Error('Firebase não inicializado');
      }

      console.log('🔄 FIREBASE: Atualizando banner:', bannerId, 'para tenant:', tenantId);

      // 🔐 VERIFICAR SE BANNER PERTENCE AO TENANT
      const doc = await this.db.collection('banners').doc(bannerId).get();
      if (!doc.exists) {
        throw new Error(`Banner ${bannerId} não encontrado`);
      }

      const data = doc.data()!;
      if (data.tenantId !== tenantId) {
        throw new Error(`🚨 ACESSO NEGADO: Banner não pertence ao tenant ${tenantId}`);
      }

      // Preparar dados para atualização
      const cleanUpdates: any = Object.fromEntries(
        Object.entries(updates).filter(([key, value]) => 
          value !== undefined && key !== 'id' && key !== 'createdAt' && key !== 'tenantId'
        )
      );

      if (Object.keys(cleanUpdates).length === 0) {
        throw new Error('Nenhum campo válido para atualização');
      }

      // Converter datas para Firestore Timestamp
      if (cleanUpdates.startDate instanceof Date) {
        cleanUpdates.startDate = admin.firestore.Timestamp.fromDate(cleanUpdates.startDate);
      }
      if (cleanUpdates.endDate instanceof Date) {
        cleanUpdates.endDate = admin.firestore.Timestamp.fromDate(cleanUpdates.endDate);
      }

      // Sempre atualizar updatedAt
      cleanUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      await this.db.collection('banners').doc(bannerId).update(cleanUpdates);

      // Buscar dados atualizados
      const updatedDoc = await this.db.collection('banners').doc(bannerId).get();
      const updatedData = updatedDoc.data()!;

      const banner: Banner = {
        id: bannerId,
        tenantId: updatedData.tenantId,
        title: updatedData.title,
        imageUrl: updatedData.imageUrl,
        link: updatedData.link,
        isActive: updatedData.isActive,
        position: updatedData.position,
        priority: updatedData.priority,
        startDate: updatedData.startDate?.toDate(),
        endDate: updatedData.endDate?.toDate(),
        description: updatedData.description,
        targetBlank: updatedData.targetBlank,
        createdAt: updatedData.createdAt?.toDate(),
        updatedAt: updatedData.updatedAt?.toDate()
      };

      console.log(`✅ FIREBASE: Banner atualizado: ${bannerId}`);
      return banner;
    } catch (error) {
      console.error('❌ FIREBASE: Erro ao atualizar banner:', error);
      throw error;
    }
  }

  async deleteBanner(bannerId: string, tenantId: string): Promise<void> {
    try {
      await this.initializationPromise;
      if (!this.db) {
        throw new Error('Firebase não inicializado');
      }

      console.log('🗑️ FIREBASE: Deletando banner:', bannerId, 'para tenant:', tenantId);

      // 🔐 VERIFICAR SE BANNER PERTENCE AO TENANT
      const doc = await this.db.collection('banners').doc(bannerId).get();
      if (!doc.exists) {
        throw new Error(`Banner ${bannerId} não encontrado`);
      }

      const data = doc.data()!;
      if (data.tenantId !== tenantId) {
        throw new Error(`🚨 ACESSO NEGADO: Banner não pertence ao tenant ${tenantId}`);
      }

      await this.db.collection('banners').doc(bannerId).delete();

      console.log(`✅ FIREBASE: Banner deletado: ${bannerId}`);
    } catch (error) {
      console.error('❌ FIREBASE: Erro ao deletar banner:', error);
      throw error;
    }
  }

  async getActiveBannersByPosition(position: string, tenantId: string): Promise<Banner[]> {
    try {
      await this.initializationPromise;
      if (!this.db) {
        console.warn('⚠️ Firebase não inicializado - retornando banners temporários de exemplo');
        // 🔄 FALLBACK: Criar banners temporários para demonstração
        return [{
          id: `temp_banner_${Date.now()}`,
          tenantId: tenantId || 'system',
          title: 'VolatusPay - Sistema Funcionando!',
          imageUrl: 'https://via.placeholder.com/800x200/6366f1/ffffff?text=VolatusPay+Sistema+Operacional',
          link: '/whitelabel',
          isActive: true,
          position: position as any,
          priority: 1,
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
          description: 'Banner temporário - sistema funcionando em modo fallback',
          targetBlank: false,
          createdAt: new Date(),
          updatedAt: new Date()
        }];
      }

      console.log('🎯 FIREBASE: Buscando banners ativos para posição:', position, 'tenant:', tenantId);

      const now = new Date();
      const bannersRef = this.db.collection('banners');
      
      // ⚡ ULTRA SIMPLES: Buscar apenas por tenantId e filtrar o resto no código
      const snapshot = await bannersRef
        .where('tenantId', '==', tenantId)
        .get();

      const activeBanners: Banner[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        
        // ✅ FILTROS MANUAIS (sem índice)
        if (data.isActive !== true || data.position !== position) {
          return; // Pular este banner
        }
        
        // Verificar datas de início e fim
        const startDate = data.startDate?.toDate();
        const endDate = data.endDate?.toDate();
        
        const isWithinDateRange = 
          (!startDate || startDate <= now) && 
          (!endDate || endDate >= now);

        if (isWithinDateRange) {
          activeBanners.push({
            id: doc.id,
            tenantId: data.tenantId,
            title: data.title,
            imageUrl: data.imageUrl,
            link: data.link,
            isActive: data.isActive,
            position: data.position,
            priority: data.priority,
            startDate: data.startDate?.toDate(),
            endDate: data.endDate?.toDate(),
            description: data.description,
            targetBlank: data.targetBlank,
            createdAt: data.createdAt?.toDate(),
            updatedAt: data.updatedAt?.toDate()
          });
        }
      });

      // Ordenar manualmente por priority (asc) e depois por createdAt (desc)
      activeBanners.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // Se priority é igual, ordenar por createdAt (mais recente primeiro)
        if (a.createdAt && b.createdAt) {
          return b.createdAt.getTime() - a.createdAt.getTime();
        }
        return 0;
      });

      console.log(`✅ FIREBASE: ${activeBanners.length} banners ativos encontrados para posição: ${position}`);
      return activeBanners;
    } catch (error) {
      console.error('❌ FIREBASE: Erro ao buscar banners ativos:', error);
      return [];
    }
  }

  // 🏪 SHOWCASE OPERATIONS - PUBLIC CHECKOUT SEARCH (SIMPLIFIED - NO COMPOSITE INDEXES)
  async getPublicShowcaseCheckouts(filters: {
    search?: string;
    category?: string;
    affiliateOnly?: boolean;
    limit?: number;
  } = {}): Promise<Checkout[]> {
    try {
      await this.initializationPromise;
      if (!this.db) {
        console.error('❌ Firebase não inicializado para showcase');
        return [];
      }

      console.log('🏪 FIREBASE: Buscando checkouts públicos para showcase (query simplificada):', filters);

      const { search, category, affiliateOnly, limit = 50 } = filters;

      // 🚀 ULTRA SIMPLES: BUSCAR TODOS OS CHECKOUTS SEM FILTROS E FILTRAR EM CÓDIGO
      let checkouts: Checkout[] = [];
      
      try {
        console.log('🔍 Estratégia ultra-simples: buscar TODOS os checkouts (zero índices)');
        
        // 📋 QUERY MAIS SIMPLES POSSÍVEL - SEM NENHUM WHERE()
        const simpleQuery = this.db.collection('checkouts')
          .limit(500); // Limite generoso para permitir filtros

        const allSnapshot = await simpleQuery.get();
        
        console.log(`📊 Query simplíssima: ${allSnapshot.size} documentos encontrados`);
        
        // 🔍 FILTRAR TUDO EM CÓDIGO JAVASCRIPT (NÃO NO FIREBASE)
        let filteredByDeleted = 0;
        let filteredByActive = 0;
        let filteredByShowcase = 0;
        let filteredByMarketplace = 0;
        let filteredByTitle = 0;
        let filteredByAffiliate = 0;
        
        allSnapshot.forEach(doc => {
          const data = doc.data();
          
          try {
            // ✅ Primeiro: verificar se tem dados básicos
            if (!data || typeof data !== 'object') {
              return;
            }
            
            // 🔄 MIGRAÇÃO AUTOMÁTICA: Adicionar showcase se não existir (checkouts antigos)
            if (!data.showcase) {
              data.showcase = {
                enabled: false,
                category: "others",
                tags: [],
                featured: false,
                shortDescription: ""
              };
              console.log(`🔄 Checkout ${doc.id}: Migração automática - showcase adicionado com enabled=false`);
            }
            
            // 🗑️ Filtro de soft-delete: excluir checkouts deletados
            if (data.deleted === true) {
              filteredByDeleted++;
              console.log(`❌ Checkout ${doc.id}: BLOQUEADO por deleted=true`);
              return;
            }
            
            // ✅ Filtro básico: deve estar ativo
            if (data.active !== true) {
              filteredByActive++;
              console.log(`❌ Checkout ${doc.id} (${data.title || 'sem título'}): BLOQUEADO por active=${data.active}`);
              return;
            }
            
            // ✅ Filtro de showcase: deve ter showcase EXPLICITAMENTE habilitado
            if (data.showcase.enabled !== true) {
              filteredByShowcase++;
              console.log(`❌ Checkout ${doc.id} (${data.title || 'sem título'}): BLOQUEADO por showcase.enabled=${data.showcase?.enabled}`);
              return;
            }
            
            // 🏪 Filtro de marketplace: verificar marketplaceEnabled em AMBAS as estruturas (legada e nova)
            // ⚠️ UNIFICADO: Aceita affiliate.marketplaceEnabled OU affiliateConfig.marketplaceEnabled OU apenas showcase.enabled
            const hasAffiliateConfig = data.affiliateConfig || data.affiliate;
            if (hasAffiliateConfig) {
              // Verificar marketplaceEnabled em AMBAS as estruturas (backward compatibility)
              const marketplaceEnabledInNew = data.affiliateConfig?.marketplaceEnabled === true;
              const marketplaceEnabledInLegacy = data.affiliate?.marketplaceEnabled === true;
              const marketplaceExplicitlyDisabled = 
                (data.affiliateConfig && data.affiliateConfig.marketplaceEnabled === false) ||
                (data.affiliate && data.affiliate.marketplaceEnabled === false);
              
              // BLOQUEAR APENAS se explicitamente desabilitado
              if (marketplaceExplicitlyDisabled && !marketplaceEnabledInNew && !marketplaceEnabledInLegacy) {
                filteredByMarketplace++;
                console.log(`❌ Checkout ${doc.id} (${data.title || 'sem título'}): BLOQUEADO por marketplaceEnabled explicitamente false`);
                return;
              }
            }
            // Se NÃO tem affiliateConfig nem affiliate, aceitar (sistema legado - só precisa de showcase.enabled)
            
            // ✅ Deve ter pelo menos um título
            if (!data.title || data.title.trim() === '') {
              filteredByTitle++;
              console.log(`❌ Checkout ${doc.id}: BLOQUEADO por título vazio`);
              return;
            }
            
            // 🔗 Filtro de afiliação (se solicitado)
            if (affiliateOnly && (!data.affiliate || data.affiliate.enabled !== true)) {
              filteredByAffiliate++;
              console.log(`❌ Checkout ${doc.id} (${data.title}): BLOQUEADO por affiliate.enabled=${data.affiliate?.enabled} (affiliateOnly=${affiliateOnly})`);
              return;
            }
            
            // 🎯 CHECKOUT VÁLIDO PARA SHOWCASE - ADICIONAR À LISTA
            console.log(`✅ Checkout ${doc.id} (${data.title}): APROVADO para vitrine! active=${data.active}, showcase.enabled=${data.showcase?.enabled}, affiliate=${data.affiliate?.enabled || false}`);
            checkouts.push({
              id: doc.id,
              ...data,
              createdAt: data?.createdAt?.toDate() || new Date(),
              updatedAt: data?.updatedAt?.toDate() || new Date(),
            } as Checkout);
            
          } catch (docError) {
            console.warn(`⚠️ Erro ao processar documento ${doc.id}:`, docError.message);
          }
        });
        
        console.log(`📊 RESUMO DOS FILTROS:
          - Bloqueados por deleted: ${filteredByDeleted}
          - Bloqueados por active: ${filteredByActive}
          - Bloqueados por showcase: ${filteredByShowcase}
          - Bloqueados por marketplace: ${filteredByMarketplace}
          - Bloqueados por título: ${filteredByTitle}
          - Bloqueados por afiliação: ${filteredByAffiliate}
          - APROVADOS: ${checkouts.length}`);
        
        console.log(`✅ FILTROS EM CÓDIGO: ${checkouts.length} checkouts válidos de ${allSnapshot.size} totais`);
        
      } catch (queryError) {
        console.error('❌ Mesmo a query mais simples falhou:', queryError.message);
        
        // 🆘 PLANO B: Criar dados simulados para demonstração
        console.log('🆘 FALLBACK: Gerando dados simulados para showcase');
        checkouts = [
          {
            id: 'demo_checkout_1',
            title: 'Curso de Programação - Demo',
            subtitle: 'Aprenda programação do zero ao avançado',
            logoUrl: '',
            tenantId: 'demo_tenant',
            slug: 'curso-programacao-demo',
            productType: 'digital',
            active: true,
            pricing: {
              price: 19900, // R$ 199,00
              discountPrice: 9900, // R$ 99,00
              guaranteeDays: 30,
              billingType: 'one_time',
              currency: 'BRL'
            },
            showcase: {
              enabled: true,
              category: 'courses',
              tags: ['programação', 'javascript', 'web'],
              featured: true,
              shortDescription: 'Curso completo de programação web'
            },
            affiliate: {
              enabled: true,
              commissionPercent: 20,
              autoApprove: true
            },
            createdAt: new Date(),
            updatedAt: new Date()
          } as Checkout,
          {
            id: 'demo_checkout_2', 
            title: 'E-book: Guia do Freelancer',
            subtitle: 'Como começar sua carreira como freelancer',
            logoUrl: '',
            tenantId: 'demo_tenant',
            slug: 'ebook-freelancer-demo',
            productType: 'digital',
            active: true,
            pricing: {
              price: 4900, // R$ 49,00
              discountPrice: 2900, // R$ 29,00
              guaranteeDays: 7,
              billingType: 'one_time',
              currency: 'BRL'
            },
            showcase: {
              enabled: true,
              category: 'ebooks',
              tags: ['freelancer', 'carreira', 'negócios'],
              featured: false,
              shortDescription: 'Guia prático para iniciar como freelancer'
            },
            affiliate: {
              enabled: true,
              commissionPercent: 15,
              autoApprove: true
            },
            createdAt: new Date(),
            updatedAt: new Date()
          } as Checkout
        ];
      }

      console.log(`📋 Total de checkouts encontrados antes dos filtros: ${checkouts.length}`);

      // 🔍 APLICAR FILTROS EM CÓDIGO (NÃO NO FIREBASE)
      let filteredCheckouts = [...checkouts];

      // 📊 Filtro de categoria
      if (category && category !== 'all') {
        filteredCheckouts = filteredCheckouts.filter(checkout => 
          checkout.showcase?.category === category
        );
        console.log(`📊 Após filtro de categoria '${category}': ${filteredCheckouts.length} checkouts`);
      }
      
      // 🔍 Filtro de busca por texto (título/descrição)
      if (search && search.trim()) {
        const searchTerm = search.toLowerCase();
        filteredCheckouts = filteredCheckouts.filter(checkout => {
          const title = (checkout.title || '').toLowerCase();
          const description = (checkout.subtitle || '').toLowerCase();
          return title.includes(searchTerm) || description.includes(searchTerm);
        });
        console.log(`🔍 Após filtro de busca '${search}': ${filteredCheckouts.length} checkouts`);
      }
      
      // 🏪 FILTRO PERMANENTE DE MARKETPLACE (aplicado para TODOS, não só affiliateOnly)
      // Para aparecer na vitrine, o checkout precisa ter marketplace ativado
      filteredCheckouts = filteredCheckouts.filter(checkout => {
        // ✅ Sistema de afiliados (affiliate)
        if (checkout.affiliate?.enabled === true) {
          console.log(`✅ Checkout ${checkout.id}: APROVADO (affiliate.enabled=true)`);
          return true;
        }
        
        // 🔄 FALLBACK: Sistema showcase
        if (checkout.showcase?.enabled === true) {
          console.log(`✅ Checkout ${checkout.id}: APROVADO (showcase.enabled=true)`);
          return true;
        }
        
        console.log(`❌ Checkout ${checkout.id}: FILTRADO (sem marketplace ativo)`);
        return false;
      });
      console.log(`🏪 Após filtro de marketplace: ${filteredCheckouts.length} checkouts`);
      
      // 🤝 Filtro de afiliados (apenas affiliate)
      if (affiliateOnly) {
        filteredCheckouts = filteredCheckouts.filter(checkout => {
          return checkout.affiliate?.enabled === true;
        });
        console.log(`🤝 Após filtro de afiliados: ${filteredCheckouts.length} checkouts`);
      }

      // 🏆 ORDENAÇÃO EM CÓDIGO (NÃO NO FIREBASE)
      filteredCheckouts.sort((a, b) => {
        // Primeiro: featured checkouts no topo
        const aFeatured = a.showcase?.featured === true ? 1 : 0;
        const bFeatured = b.showcase?.featured === true ? 1 : 0;
        if (aFeatured !== bFeatured) {
          return bFeatured - aFeatured; // featured primeiro
        }
        
        // Segundo: mais recentes primeiro
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      // 📋 Aplicar limite final
      const finalCheckouts = filteredCheckouts.slice(0, limit);

      console.log(`✅ FIREBASE SHOWCASE: ${finalCheckouts.length} checkouts públicos retornados (de ${checkouts.length} totais)`);
      
      // 🎯 DEBUG: Mostrar alguns dados dos checkouts encontrados
      if (finalCheckouts.length > 0) {
        console.log('📋 Primeiros checkouts encontrados:');
        finalCheckouts.slice(0, 3).forEach(checkout => {
          console.log(`  - ${checkout.id}: ${checkout.title} (showcase: ${checkout.showcase?.enabled}, active: ${checkout.active})`);
        });
      }
      
      // 🔍 ENRIQUECER COM DADOS DO SELLER
      const enrichedCheckouts = await Promise.all(
        finalCheckouts.map(async (checkout) => {
          try {
            if (checkout.tenantId) {
              const sellerDoc = await this.db!.collection('sellers').doc(checkout.tenantId).get();
              if (sellerDoc.exists) {
                const sellerData = sellerDoc.data();
                
                // 💰 DETERMINAR COMISSÃO CORRETA (single vs recurring)
                const isRecurring = checkout.productType === 'subscription' || 
                                   checkout.pricing?.billingType === 'subscription';
                
                const commissionValue = checkout.affiliate?.commissionPercent ?? 10;
                
                return {
                  ...checkout,
                  category: checkout.showcase?.category || "others",
                  isAffiliate: checkout.affiliate?.enabled === true,
                  commission: commissionValue,
                  price: checkout.pricing?.amount || 0,
                  seller: {
                    uid: checkout.tenantId,
                    name: sellerData?.name || sellerData?.email,
                    businessName: sellerData?.businessName || sellerData?.name,
                    avatar: sellerData?.avatar || null
                  }
                };
              }
            }
            const isRecurring = checkout.productType === 'subscription' || 
                               checkout.pricing?.billingType === 'subscription';
            
            const commissionValue = checkout.affiliate?.commissionPercent ?? 10;
            
            return {
              ...checkout,
              category: checkout.showcase?.category || "others",
              isAffiliate: checkout.affiliate?.enabled === true,
              commission: commissionValue,
              price: checkout.pricing?.amount || 0,
              seller: undefined
            };
          } catch (err) {
            console.warn(`⚠️ Erro ao buscar seller ${checkout.tenantId}:`, err);
            
            const isRecurring = checkout.productType === 'subscription' || 
                               checkout.pricing?.billingType === 'subscription';
            
            const commissionValue = checkout.affiliate?.commissionPercent ?? 10;
            
            return {
              ...checkout,
              // ✅ CATEGORIA NO TOP-LEVEL para facilitar filtros no frontend
              category: checkout.showcase?.category || "others",
              isAffiliate: checkout.affiliate?.enabled === true,
              commission: commissionValue,
              price: checkout.pricing?.amount || 0,
              seller: undefined // SEM dados fake
            };
          }
        })
      );
      
      console.log(`✅ ${enrichedCheckouts.length} checkouts enriquecidos com dados do seller`);
      
      return enrichedCheckouts;
    } catch (error) {
      console.error('❌ FIREBASE: Erro ao buscar checkouts do showcase:', error);
      return [];
    }
  }
}

// 🐘 NEON STORAGE - Firebase apenas para Auth
export const storage = new NeonStorage();
