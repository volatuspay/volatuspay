import { db, auth } from "@/lib/firebase";
import { 
  collection, 
  addDoc, 
  getDocs, 
  getDoc, 
  doc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  query, 
  where, 
  orderBy, 
  limit,
  serverTimestamp,
  DocumentData,
  Timestamp
} from "firebase/firestore";

/**
 * 🚀 BACKWARD COMPATIBILITY: Normaliza response da API para suportar { data, pagination }
 * 
 * CONTEXT: Mudança de paginação para suportar 120k+ usuários sem quebrar frontend
 * - OLD FORMAT: Array direto (ex: [order1, order2, ...])
 * - NEW FORMAT: { data: [...], pagination: { hasMore, nextCursor, ... } }
 * 
 * @param response - Response da API (pode ser array OU { data, pagination })
 * @returns Sempre retorna { data: [], pagination: {} } com defaults seguros
 */
export function normalizePaginatedResponse<T>(response: any): { 
  data: T[], 
  pagination: { hasMore: boolean, nextCursor: string | null, limit: number, count: number } 
} {
  // Caso 1: Response já está no formato novo { data, pagination }
  if (response && typeof response === 'object' && 'data' in response && Array.isArray(response.data)) {
    return {
      data: response.data,
      pagination: response.pagination || {
        hasMore: false,
        nextCursor: null,
        limit: response.data.length,
        count: response.data.length
      }
    };
  }
  
  // Caso 2: Response é array direto (formato antigo) - BACKWARD COMPATIBILITY
  if (Array.isArray(response)) {
    return {
      data: response,
      pagination: {
        hasMore: false,
        nextCursor: null,
        limit: response.length,
        count: response.length
      }
    };
  }
  
  // Caso 3: Response inválido - retornar vazio seguro
  console.warn('⚠️ Response inválido recebido, retornando array vazio:', response);
  return {
    data: [],
    pagination: {
      hasMore: false,
      nextCursor: null,
      limit: 0,
      count: 0
    }
  };
}

/**
 * Normaliza qualquer valor de timestamp do Firestore para Date JavaScript.
 * Suporta múltiplos formatos:
 * - Date nativo → retorna direto
 * - Firestore Timestamp {seconds, nanoseconds} → converte
 * - Firestore Timestamp {_seconds, _nanoseconds} → converte
 * - String ISO → new Date()
 * - Number (epoch ms) → new Date()
 * - null/undefined → retorna fallback ou null
 * 
 * @param input - Valor a ser convertido
 * @param fallback - Data padrão se conversão falhar (opcional)
 * @returns Date válido ou null
 */
export function normalizeTimestamp(input: unknown, fallback?: Date): Date | null {
  // Já é Date nativo
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? (fallback || null) : input;
  }
  
  // null ou undefined
  if (input == null) {
    return fallback || null;
  }
  
  // Firestore Timestamp: {seconds, nanoseconds} ou {_seconds, _nanoseconds}
  if (typeof input === 'object' && input !== null) {
    const obj = input as any;
    
    // Verificar formato com underline (_seconds) ou sem (seconds)
    const seconds = obj._seconds ?? obj.seconds;
    const nanoseconds = obj._nanoseconds ?? obj.nanoseconds ?? 0;
    
    if (typeof seconds === 'number') {
      const date = new Date(seconds * 1000 + nanoseconds / 1000000);
      return isNaN(date.getTime()) ? (fallback || null) : date;
    }
  }
  
  // String ISO ou Number epoch
  if (typeof input === 'string' || typeof input === 'number') {
    const date = new Date(input);
    return isNaN(date.getTime()) ? (fallback || null) : date;
  }
  
  // Fallback final
  return fallback || null;
}

/**
 * Type guard para verificar se um valor é Firestore Timestamp
 */
export function isFirestoreTimestamp(input: unknown): input is { 
  seconds?: number; 
  _seconds?: number; 
  nanoseconds?: number; 
  _nanoseconds?: number; 
} {
  if (typeof input !== 'object' || input === null) return false;
  const obj = input as any;
  return typeof (obj._seconds ?? obj.seconds) === 'number';
}

// CALCULAR MTRICAS REAIS DE CONVERSÃO POR MTODO DE PAGAMENTO
export const calculatePaymentMethodMetrics = async (tenantId: string) => {
  try {
    console.log('Calculando métricas via API backend para tenant:', tenantId);
    
    // BUSCAR VENDAS VIA API BACKEND (SEM ACESSO DIRETO AO FIREBASE)
    // 🚀 CRITICAL: Passar limit=9999 para garantir TODOS os dados para métricas
    const response = await fetch(`/api/orders/by-tenant/${tenantId}?limit=9999`, {
      method: 'GET',
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status}`);
    }
    
    const rawResponse = await response.json();
    
    // 🚀 BACKWARD COMPATIBILITY: Normalizar response (array OU { data, pagination })
    const normalized = normalizePaginatedResponse<any>(rawResponse);
    const orders = normalized.data;
    
    // SEPARAR POR MTODO DE PAGAMENTO
    const pixOrders = orders.filter((order: any) => order.method === 'pix');
    const cardBROrders = orders.filter((order: any) => 
      (order.method === 'card' || order.method === 'credit_card') && 
      order.processor !== 'stripe'
    );
    const cardGlobalOrders = orders.filter((order: any) => 
      (order.method === 'card' || order.method === 'credit_card') && 
      order.processor === 'stripe'
    );
    const boletoOrders = orders.filter((order: any) => order.method === 'boleto');
    
    // CALCULAR MTRICAS PARA CADA MTODO
    const calculateMetricsForMethod = (methodOrders: any[]) => {
      const total = methodOrders.length;
      const paid = methodOrders.filter((order: any) => order.status === 'paid').length;
      const pending = methodOrders.filter((order: any) => order.status === 'pending').length;
      const paidPercent = total > 0 ? Math.round((paid / total) * 100) : 0;
      const pendingPercent = total > 0 ? Math.round((pending / total) * 100) : 0;
      
      return { paid, pending, total, paidPercent, pendingPercent };
    };
    
    const pixMetrics = calculateMetricsForMethod(pixOrders);
    const cardBRMetrics = calculateMetricsForMethod(cardBROrders);
    const cardGlobalMetrics = calculateMetricsForMethod(cardGlobalOrders);
    const boletoMetrics = calculateMetricsForMethod(boletoOrders);
    
    console.log('Métricas calculadas:', {
      pix: `${pixMetrics.paid} pagos / ${pixMetrics.pending} pendentes / ${pixMetrics.total} total (${pixMetrics.paidPercent}% conversão)`,
      cardBR: `${cardBRMetrics.paid} pagos / ${cardBRMetrics.pending} pendentes / ${cardBRMetrics.total} total (${cardBRMetrics.paidPercent}% conversão)`,
      cardGlobal: `${cardGlobalMetrics.paid} pagos / ${cardGlobalMetrics.pending} pendentes / ${cardGlobalMetrics.total} total (${cardGlobalMetrics.paidPercent}% conversão)`,
      boleto: `${boletoMetrics.paid} pagos / ${boletoMetrics.pending} pendentes / ${boletoMetrics.total} total (${boletoMetrics.paidPercent}% conversão)`
    });
    
    return { pixMetrics, cardBRMetrics, cardGlobalMetrics, boletoMetrics };
    
  } catch (error) {
    console.error('Erro ao calcular métricas por método:', error);
    return {
      pixMetrics: { paid: 0, pending: 0, total: 0, paidPercent: 0, pendingPercent: 0 },
      cardBRMetrics: { paid: 0, pending: 0, total: 0, paidPercent: 0, pendingPercent: 0 },
      cardGlobalMetrics: { paid: 0, pending: 0, total: 0, paidPercent: 0, pendingPercent: 0 },
      boletoMetrics: { paid: 0, pending: 0, total: 0, paidPercent: 0, pendingPercent: 0 }
    };
  }
};

import type { 
  Tenant, 
  InsertTenant, 
  Checkout, 
  InsertCheckout, 
  Order,
  Product,
  InsertProduct,
  Module,
  InsertModule,
  Lesson,
  InsertLesson,
  Member,
  InsertMember,
  Enrollment,
  InsertEnrollment,
  Progress,
  InsertProgress,
  Refund,
  InsertRefund
} from "@shared/schema";

import {
  generateRefundId
} from "@shared/schema";

// Utility function to convert Firestore timestamps
const convertTimestamp = (timestamp: any): Date => {
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  if (timestamp && typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  if (timestamp instanceof Date) {
    return timestamp;
  }
  if (typeof timestamp === 'string') {
    return new Date(timestamp);
  }
  return new Date();
};

// Tenant operations
export const createTenant = async (tenantData: InsertTenant): Promise<Tenant> => {
  const docRef = await addDoc(collection(db, "tenants"), {
    ...tenantData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  
  const docSnap = await getDoc(docRef);
  const data = docSnap.data()!;
  
  return {
    id: docRef.id,
    ...data,
    createdAt: convertTimestamp(data.createdAt),
    updatedAt: convertTimestamp(data.updatedAt),
  } as Tenant;
};

export const getTenantByOwnerId = async (ownerId: string): Promise<Tenant | null> => {
  const q = query(
    collection(db, "tenants"), 
    where("ownerId", "==", ownerId),
    limit(1)
  );
  
  const querySnapshot = await getDocs(q);
  
  if (querySnapshot.empty) {
    return null;
  }
  
  const doc = querySnapshot.docs[0];
  const data = doc.data();
  
  return {
    id: doc.id,
    ...data,
    createdAt: convertTimestamp(data.createdAt),
    updatedAt: convertTimestamp(data.updatedAt),
  } as Tenant;
};

export const getTenant = async (tenantId: string): Promise<Tenant | null> => {
  const docRef = doc(db, "tenants", tenantId);
  const docSnap = await getDoc(docRef);
  
  if (!docSnap.exists()) {
    return null;
  }
  
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: convertTimestamp(data.createdAt),
    updatedAt: convertTimestamp(data.updatedAt),
  } as Tenant;
};

// Checkout operations
export const createCheckout = async (checkoutData: InsertCheckout): Promise<Checkout> => {
  console.log("Criando checkout via API backend segura...");
  
  // VALIDAÇÃO CRTICA: Garantir que amount existe e é vlido
  const checkoutAmount = checkoutData.pricing?.amount;
  if (!checkoutAmount || checkoutAmount <= 0) {
    console.error('ERRO CRTICO: Checkout sem valor vlido. Amount:', checkoutAmount);
    throw new Error('Checkout deve ter um valor (amount) vlido');
  }
  
  // OBTER TOKEN DE AUTENTICAÇÃO FIREBASE
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Usuário no autenticado");
  }
  
  const token = await user.getIdToken();
  
  // CRIAR CHECKOUT VIA API BACKEND (com validao, rate limiting e segurana)
  const response = await fetch('/api/checkouts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(checkoutData)
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Falha ao criar checkout');
  }
  
  const responseData = await response.json();
  const checkout = responseData.checkout;
  
  console.log("CHECKOUT CRIADO VIA API BACKEND:", checkout.id);
  console.log("Produto sincronizado automaticamente pelo backend")
  
  return checkout;
};

export const updateCheckout = async (checkoutId: string, updates: Partial<InsertCheckout>): Promise<void> => {
  console.log("UPDATE CHECKOUT - INICIANDO COM SISTEMA AUTOMTICO DE AFILIADOS:", { checkoutId, updates });
  console.log("VALOR ALTERADO:", updates.pricing?.amount ? `R$ ${(updates.pricing.amount / 100).toFixed(2)}` : "No informado");
  console.log("autoApprove:", updates.affiliate?.autoApprove !== undefined ? updates.affiliate.autoApprove : "No alterado");
  
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Usuário no autenticado');
    }
    
    const token = await user.getIdToken();
    
    // USAR NOVO ENDPOINT QUE ATUALIZA AFILIADOS AUTOMATICAMENTE
    const response = await fetch(`/api/checkout/update/${checkoutId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Erro ao atualizar checkout');
    }

    const result = await response.json();
    
    console.log("UPDATE COMPLETO VIA API COM SISTEMA DE AFILIADOS!");
    console.log("DADOS SALVOS ETERNAMENTE NO FIREBASE!");
    
    if (result.affiliatesUpdated) {
      console.log("AFILIADOS ATUALIZADOS AUTOMATICAMENTE EM TEMPO REAL!");
    }
    
    // FALLBACK: Se API falhar, usar método direto (sem atualização de afiliados)
  } catch (apiError) {
    console.warn("API falhou, usando fallback direto:", apiError);
    
    // Limpar dados undefined/null que podem causar erro no Firestore
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined && v !== null)
    );
    
    console.log("DADOS LIMPOS PARA UPDATE (FALLBACK):", cleanUpdates);
    console.log("PREÇO FINAL SENDO SALVO:", (cleanUpdates.pricing as any)?.amount || "Não encontrado");
    
    const docRef = doc(db, "checkouts", checkoutId);
    const updateData = {
      ...cleanUpdates,
      updatedAt: serverTimestamp(),
    };
    
    console.log("EXECUTANDO UPDATE DIRETO NO FIRESTORE (FALLBACK)...");
    console.log("ENVIANDO PARA:", `checkouts/${checkoutId}`);
    await updateDoc(docRef, updateData);
    console.log("UPDATE CONCLUDO VIA FALLBACK (SEM ATUALIZAÇÃO AUTOMTICA DE AFILIADOS)");
    console.log("DADOS SALVOS ETERNAMENTE EM: pag-flex.firebaseapp.com");
  }
    
  // SINCRONIZAR PRODUTO COM MESMO ID DO CHECKOUT  
  try {
    console.log("Sincronizando produto com checkout...");
      
      // LIMPEZA AUTOMTICA: Se o ttulo mudou, pode ser um checkout reutilizado - limpar conteúdo rfo
      if (updates.title) {
        try {
          console.log("Ttulo alterado - verificando limpeza de conteúdo rfo:", updates.title);
          
          const { query: firestoreQuery, collection: firestoreCollection, getDocs: getDocsFunction, deleteDoc, where } = await import("firebase/firestore");
          
          // Buscar mdulos rfos para este produto
          const modulesQuery = firestoreQuery(
            firestoreCollection(db, "modules"),
            where("productId", "==", checkoutId)
          );
          
          const modulesSnapshot = await getDocsFunction(modulesQuery);
          
          if (!modulesSnapshot.empty) {
            console.log(`Limpando ${modulesSnapshot.size} mdulos rfos após mudana de ttulo`);
            
            for (const moduleDoc of modulesSnapshot.docs) {
              // Deletar aulas do mdulo primeiro
              const lessonsQuery = firestoreQuery(
                firestoreCollection(db, "lessons"),
                where("moduleId", "==", moduleDoc.id)
              );
              
              const lessonsSnapshot = await getDocsFunction(lessonsQuery);
              
              for (const lessonDoc of lessonsSnapshot.docs) {
                await deleteDoc(lessonDoc.ref);
                console.log(`Aula rfremovida: ${lessonDoc.id}`);
              }
              
              // Depois deletar o mdulo
              await deleteDoc(moduleDoc.ref);
              console.log(`Mdulo rfo removido: ${moduleDoc.id}`);
            }
          }
          
          // Buscar e deletar aulas rfs diretas
          const orphanLessonsQuery = firestoreQuery(
            firestoreCollection(db, "lessons"),
            where("productId", "==", checkoutId)
          );
          
          const orphanLessonsSnapshot = await getDocsFunction(orphanLessonsQuery);
          
          if (!orphanLessonsSnapshot.empty) {
            console.log(`Limpando ${orphanLessonsSnapshot.size} aulas rfs diretas`);
            
            for (const lessonDoc of orphanLessonsSnapshot.docs) {
              await deleteDoc(lessonDoc.ref);
              console.log(`Aula rfdireta removida: ${lessonDoc.id}`);
            }
          }
          
          console.log("LIMPEZA DE UPDATE CONCLUDA: Conteúdo rfo removido");
          
        } catch (cleanupError) {
          // Silenciado: permission-denied é comportamento normal do frontend
        }
      }
      
      const productUpdates: any = {};
      
      if (updates.title) {
        productUpdates.title = updates.title;
      }
      if (updates.subtitle) {
        productUpdates.description = updates.subtitle;
      }
      if (updates.logoUrl) {
        productUpdates.imageUrl = updates.logoUrl;
      }
      if (updates.active !== undefined) {
        productUpdates.active = updates.active;
      }
      if (updates.pricing?.guaranteeDays) {
        productUpdates.guaranteeDays = updates.pricing.guaranteeDays;
      }
      
      if (Object.keys(productUpdates).length > 0) {
        const productRef = doc(db, "products", checkoutId);
        
        // Verificar se produto existe antes de atualizar
        const { getDoc: getDocFunction } = await import("firebase/firestore");
        const productSnap = await getDocFunction(productRef);
        
        if (productSnap.exists()) {
          await updateDoc(productRef, {
            ...productUpdates,
            updatedAt: serverTimestamp(),
          });
          console.log("PRODUTO SINCRONIZADO COM CHECKOUT!");
        } else {
          console.log("Produto no existe - pulando sincronizao (checkout sem produto associado)");
        }
      }
      
  } catch (syncError) {
    console.warn("Erro na sincronizao do produto:", syncError);
    // No falhar o update do checkout se sincronizao der erro
  }
};

export const getCheckout = async (checkoutId: string): Promise<Checkout | null> => {
  const docRef = doc(db, "checkouts", checkoutId);
  const docSnap = await getDoc(docRef);
  
  if (!docSnap.exists()) {
    return null;
  }
  
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: convertTimestamp(data.createdAt),
    updatedAt: convertTimestamp(data.updatedAt),
  } as Checkout;
};

export const getCheckoutBySlug = async (slug: string): Promise<Checkout | null> => {
  try {
    console.log('BUSCANDO CHECKOUT POR SLUG:', slug);
    
    // PRIMEIRO: Tentar buscar diretamente pelo ID (slug = checkoutId)
    const docRef = doc(db, "checkouts", slug);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      console.log('CHECKOUT ENCONTRADO PELO ID:', slug);
      return {
        id: docSnap.id,
        ...data,
        createdAt: convertTimestamp(data.createdAt),
        updatedAt: convertTimestamp(data.updatedAt),
      } as Checkout;
    }
    
    // FALLBACK: Buscar por campo slug se existir
    console.log('Tentando buscar por campo slug...');
    const q = query(
      collection(db, "checkouts"), 
      where("slug", "==", slug),
      where("active", "==", true),
      limit(1)
    );
    
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      const data = doc.data();
      console.log('CHECKOUT ENCONTRADO POR CAMPO SLUG:', slug);
      
      return {
        id: doc.id,
        ...data,
        createdAt: convertTimestamp(data.createdAt),
        updatedAt: convertTimestamp(data.updatedAt),
      } as Checkout;
    }
    
    console.log('CHECKOUT NÃO ENCONTRADO:', slug);
    return null;
    
  } catch (error) {
    console.error('ERRO ao buscar checkout por slug:', error);
    return null;
  }
};

export const getCheckoutsByTenant = async (tenantId: string): Promise<Checkout[]> => {
  try {
    // Usar API backend para evitar problemas de permissão do Firestore
    const token = await auth.currentUser?.getIdToken();
    
    const response = await fetch(`/api/checkouts-by-tenant/${tenantId}`, {
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` })
      }
    });
    
    if (!response.ok) {
      console.error('Erro ao buscar checkouts via API:', response.status);
      return [];
    }
    
    const data = await response.json();
    const checkouts = (data.checkouts || data || []).map((item: any) => ({
      ...item,
      createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
      updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
    })) as Checkout[];
    
    // Ordenar por data de criação (mais recente primeiro)
    return checkouts.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (error) {
    console.error('Erro ao carregar checkouts:', error);
    return [];
  }
};

// FUNÇÃO INTELIGENTE: Busca checkouts tanto por tenantId quanto por userId (para casos de tenantId vazio)
export const getCheckoutsByTenantOrUser = async (tenantId: string | null, userId: string | null): Promise<Checkout[]> => {
  console.log("Buscando checkouts - tenantId:", tenantId, "userId:", userId);
  
  const allCheckouts: Checkout[] = [];
  
  // 1. Se tenantId válido, buscar por ele (usando API backend)
  if (tenantId && tenantId !== "null" && tenantId !== "") {
    try {
      const tenantCheckouts = await getCheckoutsByTenant(tenantId);
      allCheckouts.push(...tenantCheckouts);
      console.log("Checkouts por tenantId:", tenantCheckouts.length);
    } catch (error) {
      console.warn("Erro ao buscar por tenantId:", error);
    }
  }
  
  // 2. Se userId válido e tenantId vazio, buscar checkouts órfãos via API
  if (userId && userId !== "null" && userId !== "" && (!tenantId || tenantId === "null" || tenantId === "")) {
    try {
      // Buscar checkouts órfãos usando o userId como tenantId alternativo
      const orphanCheckouts = await getCheckoutsByTenant(userId);
      allCheckouts.push(...orphanCheckouts);
      console.log("Checkouts órfãos encontrados:", orphanCheckouts.length);
    } catch (error) {
      console.warn("Erro ao buscar checkouts órfãos:", error);
    }
  }
  
  // Remover duplicatas e ordenar
  const uniqueCheckouts = Array.from(
    new Map(allCheckouts.map(c => [c.id, c])).values()
  );
  
  const sorted = uniqueCheckouts.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  
  console.log("Total checkouts encontrados:", sorted.length);
  return sorted;
};

// VERIFICAR SE CHECKOUT PODE SER DELETADO (PROTEÇÃO CONTRA ASSINATURAS ATIVAS)
export const checkCheckoutDeletable = async (checkoutId: string, tenantId: string): Promise<{
  canDelete: boolean;
  reason: string;
  activeSubscriptions: any[];
  activeCount: number;
}> => {
  // Obter token de autenticação Firebase
  let token: string | null = null;
  try {
    const user = auth.currentUser;
    if (user) {
      token = await user.getIdToken();
      console.log('Token de autenticação obtido para:', user.uid);
      console.log('Authorization header adicionado requisio');
    }
  } catch (error) {
    console.error('Erro ao obter token de autenticação:', error);
  }
  
  const response = await fetch('/api/check-checkout-deletable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    },
    body: JSON.stringify({ checkoutId, tenantId })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao verificar checkout: ${errorText}`);
  }
  
  // Verificar se é JSON vlido
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Resposta no é JSON: ${text}`);
  }
  
  // PROTEGER CONTRA "UNAUTHORIZED" BUG  
  const responseText = await response.text();
  if (!responseText || responseText.trim() === 'unauthorized' || responseText.includes('unauthorized')) {
    throw new Error('Erro de autenticação - Verificar credenciais');
  }
  
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError: any) {
    console.error('Erro JSON parse - checkCheckoutDeletable:', responseText.substring(0, 100));
    throw new Error(`Resposta inválida: ${parseError.message}`);
  }
  
  return data;
};

export const deleteCheckout = async (checkoutId: string): Promise<void> => {
  console.log("DELEÇÃO PERMANENTE CHECKOUT + REA DE MEMBROS:", checkoutId);
  console.log("ATENÇÃO: Deleo real do Firebase - sem recuperao!");
  
  // OBTER TOKEN DE AUTENTICAÇÃO
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Usuário no autenticado');
  }
  
  const token = await currentUser.getIdToken();
  if (!token) {
    throw new Error('Token de autenticação não encontrado');
  }
  
  // 1DELETAR CHECKOUT VIA API BACKEND (SEM ACESSO DIRETO AO FIREBASE)
  const response = await fetch(`/api/checkout/${checkoutId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}` // ADICIONAR TOKEN DE AUTENTICAÇÃO
    }
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Erro ao solicitar excluso do checkout');
  }
  
  console.log("CHECKOUT DELETADO PERMANENTEMENTE VIA API:", checkoutId);
  
  // BACKEND CUIDA DA LIMPEZA COMPLETA (produtos, mdulos, aulas, etc.)
  // Security: User process completed
};

// FUNÇÃO ESPECIAL PARA LIMPEZA DE CHECKOUTS DE USURIOS ESPECFICOS
export const cleanupCheckoutsForSpecificUsers = async (emails: string[]): Promise<void> => {
  // Security: User process completed
  // Funo administrativa - por enquanto apenas log
};

// Order operations
export const getOrder = async (orderId: string): Promise<Order | null> => {
  const docRef = doc(db, "orders", orderId);
  const docSnap = await getDoc(docRef);
  
  if (!docSnap.exists()) {
    return null;
  }
  
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: convertTimestamp(data.createdAt),
    updatedAt: convertTimestamp(data.updatedAt),
  } as Order;
};

export const getOrdersByTenant = async (tenantId: string): Promise<Order[]> => {
  // USAR API DO BACKEND (SOLUÇÃO DE PERMISSES FIRESTORE)
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('Usuário no autenticado');
      return [];
    }
    
    const token = await user.getIdToken();
    const { getBrowserId } = await import('./browser-session');
    const browserId = getBrowserId();
    console.log(`[getOrdersByTenant] Buscando orders para tenant: ${tenantId.substring(0, 8)}...`);
    const response = await fetch(`/api/orders?tenantId=${tenantId}&limit=9999`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Browser-Id': browserId
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      console.error(`[getOrdersByTenant] Erro HTTP ${response.status}:`, errorText.substring(0, 200));
      return [];
    }
    
    const rawResponse = await response.json();
    
    const normalized = normalizePaginatedResponse<any>(rawResponse);
    const orders = normalized.data;
    console.log(`[getOrdersByTenant] ${orders.length} orders recebidas do backend`);
    
    // Converter timestamps e filtrar vendas fsicas migradas
    const processedOrders = orders
      .map((order: any) => ({
        ...order,
        createdAt: normalizeTimestamp(order.createdAt, new Date()),
        updatedAt: order.updatedAt ? normalizeTimestamp(order.updatedAt) : null
      }))
      .filter((order: any) => !order.migratedToPhysicalSales);
    
    // ORDENAR - mais recente primeiro
    return processedOrders.sort((a: any, b: any) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });
  } catch (error) {
    console.error('Erro ao buscar vendas via API:', error);
    return [];
  }
};

// CACHE TEMPORRIO para evitar mltiplas consultas do mesmo usuário
const userTypeCache = new Map<string, { result: boolean; timestamp: number }>();
const CACHE_DURATION = 30000; // 30 segundos

// LIMPAR CACHE DE TIPO DE USURIO (chamar após login/logout)
export const clearUserTypeCache = () => {
  console.log('Limpando cache de tipo de usuário');
  userTypeCache.clear();
};

// DETECTAR SE USURIO SELLER OU CUSTOMER
export const isUserSeller = async (userUid: string): Promise<boolean> => {
  console.log(`[isUserSeller] Verificando tipo para UID: ${userUid.substring(0, 8)}...`);
  
  // ⚡ ADMIN SHORTCUT: Admin nunca é seller - evita queries desnecessárias
  try {
    if (auth.currentUser) {
      const tokenResult = await auth.currentUser.getIdTokenResult();
      const isAdminClaim = tokenResult.claims?.admin === true || tokenResult.claims?.superAdmin === true;
      if (isAdminClaim) {
        console.log(`[isUserSeller] ADMIN detectado via token claims - retornando false`);
        return false;
      }
    }
  } catch {}
  
  // VERIFICAR CACHE PRIMEIRO (evita consultas desnecessrias)
  const cached = userTypeCache.get(userUid);
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    console.log(`[isUserSeller] Usando cache: ${cached.result ? 'SELLER' : 'CUSTOMER'}`);
    return cached.result;
  }
  
  try {
    // USAR ENDPOINT BACKEND COM AUTENTICAÇÃO
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      const { getBrowserId } = await import('./browser-session');
      const browserId = getBrowserId();
      const response = await fetch(`/api/user-type/${userUid}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Browser-Id': browserId
        }
      });
      if (response.ok) {
        const result = await response.json();
        // ADMIN NÃO SELLER - evita tentativas de tracking inválidas
        const isSeller = result.type === 'seller';
        console.log(`[isUserSeller] Tipo detectado via API: ${result.type.toUpperCase()} isSeller=${isSeller}`);
        
        // SALVAR NO CACHE
        userTypeCache.set(userUid, { result: isSeller, timestamp: Date.now() });
        return isSeller;
      } else {
        console.warn(`[isUserSeller] API retornou status ${response.status}`);
      }
    } else {
      console.warn(`[isUserSeller] Nenhum usuário autenticado no Firebase Auth`);
    }
  } catch (error) {
    console.error('[isUserSeller] Erro na API, usando fallback Firestore:', error);
  }
  
  try {
    console.log(`[isUserSeller] Fallback mínimo: verificando doc direto em sellers...`);
    const sellerDocRef = doc(db, "sellers", userUid);
    const sellerDocSnap = await getDoc(sellerDocRef);
    
    if (sellerDocSnap.exists()) {
      console.log(`[isUserSeller] SELLER encontrado via doc ID direto!`);
      userTypeCache.set(userUid, { result: true, timestamp: Date.now() });
      return true;
    }
    
    console.log(`[isUserSeller] CUSTOMER confirmado (doc sellers não existe)`);
    userTypeCache.set(userUid, { result: false, timestamp: Date.now() });
    return false;
  } catch (error) {
    console.error('[isUserSeller] Erro no fallback Firestore:', error);
    
    return false;
  }
};

// BUSCAR EMAIL DO VENDEDOR POR TENANT ID
export const getSellerEmailByTenantId = async (tenantId: string): Promise<string | null> => {
  try {
    // Security: User process completed
    
    // Primeiro buscar o tenant para pegar o ownerId
    const tenantDoc = await getDoc(doc(db, "tenants", tenantId));
    
    if (!tenantDoc.exists()) {
      console.log(`Tenant ${tenantId} não encontrado`);
      return null;
    }
    
    const tenantData = tenantDoc.data();
    const ownerId = tenantData.ownerId;
    
    if (!ownerId) {
      console.log(`Tenant ${tenantId} sem ownerId`);
      return null;
    }
    
    // Buscar o seller pelo ownerId (que é o userId)
    const sellersQuery = query(
      collection(db, "sellers"),
      where("userId", "==", ownerId),
      limit(1)
    );
    
    const sellersSnapshot = await getDocs(sellersQuery);
    
    if (sellersSnapshot.empty) {
      console.log(`Seller não encontrado para ownerId: ${ownerId}`);
      return null;
    }
    
    const sellerData = sellersSnapshot.docs[0].data();
    const email = sellerData.email;
    
    // Security: User process completed
    return email;
    
  } catch (error) {
    console.error(`Erro ao buscar email do vendedor:`, error);
    return null;
  }
};

// VERIFICAR STATUS DO SELLER (PENDING/APPROVED/REJECTED)
export const getSellerStatus = async (userUid: string): Promise<{ 
  status: 'pending' | 'approved' | 'rejected' | 'not_seller',
  seller?: any 
}> => {
  // Security: User process completed
  
  // Buscar seller na coleo sellers - CORRIGIDO: usar userId ao invés de ownerId
  const sellersQuery = query(
    collection(db, "sellers"),
    where("userId", "==", userUid),
    limit(1)
  );
  
  const sellersSnapshot = await getDocs(sellersQuery);
  
  if (sellersSnapshot.empty) {
    // Security: User process completed
    return { status: 'not_seller' };
  }
  
  const sellerDoc = sellersSnapshot.docs[0];
  const sellerData = sellerDoc.data();
  
  const seller = {
    id: sellerDoc.id,
    ...sellerData,
    createdAt: convertTimestamp(sellerData.createdAt),
    updatedAt: convertTimestamp(sellerData.updatedAt),
    approvedAt: sellerData.approvedAt ? convertTimestamp(sellerData.approvedAt) : null,
    rejectedAt: sellerData.rejectedAt ? convertTimestamp(sellerData.rejectedAt) : null,
  };
  
  // Security: User process completed
  
  return {
    status: sellerData.status as 'pending' | 'approved' | 'rejected',
    seller
  };
};

// BUSCAR PRODUTOS COMPRADOS POR EMAIL
export const getProductsPurchasedByEmail = async (email: string): Promise<any[]> => {
  // Security: User process completed
  
  // Buscar pedidos pagos com esse email
  const ordersQuery = query(
    collection(db, "orders"),
    where("customer.email", "==", email.toLowerCase()),
    where("status", "==", "paid")
  );
  
  const ordersSnapshot = await getDocs(ordersQuery);
  console.log("Pedidos encontrados:", ordersSnapshot.size);
  
  const orders = ordersSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: convertTimestamp(data.createdAt),
      updatedAt: convertTimestamp(data.updatedAt),
    } as Order;
  });
  
  // Buscar checkouts e produtos associados
  const checkoutIds = Array.from(new Set(orders.map(order => order.checkoutId)));
  const products = [];
  
  for (const checkoutId of checkoutIds) {
    try {
      // Buscar checkout
      const checkoutDoc = await getDoc(doc(db, "checkouts", checkoutId));
      if (!checkoutDoc.exists()) continue;
      
      const checkoutData = checkoutDoc.data();
      
      // Buscar produtos vinculados a este checkout
      const productsQuery = query(
        collection(db, "products"),
        where("checkoutId", "==", checkoutId)
      );
      
      const productsSnapshot = await getDocs(productsQuery);
      
      for (const productDoc of productsSnapshot.docs) {
        const productData = productDoc.data();
        products.push({
          id: productDoc.id,
          ...productData,
          checkoutTitle: checkoutData.title,
          purchaseDate: orders.find(o => o.checkoutId === checkoutId)?.createdAt,
          createdAt: convertTimestamp(productData.createdAt),
          updatedAt: convertTimestamp(productData.updatedAt),
        });
      }
    } catch (error) {
      console.error("Erro ao buscar produto do checkout", checkoutId, error);
    }
  }
  
  console.log("Produtos encontrados:", products.length);
  return products;
};

// ATUALIZAR STATUS DE PEDIDO
export const updateOrderStatus = async (orderId: string, status: "pending" | "paid" | "cancelled" | "expired" | "failed"): Promise<void> => {
  console.log(`Atualizando pedido ${orderId} para status: ${status}`);
  
  const orderRef = doc(db, "orders", orderId);
  const updateData: any = {
    status,
    updatedAt: serverTimestamp(),
  };
  
  // Se status for "paid", adicionar paidAt
  if (status === "paid") {
    updateData.paidAt = serverTimestamp();
  }
  
  await updateDoc(orderRef, updateData);
  console.log(`Status do pedido ${orderId} atualizado para: ${status}`);
};

export const getOrdersByCheckout = async (checkoutId: string): Promise<Order[]> => {
  const q = query(
    collection(db, "orders"), 
    where("checkoutId", "==", checkoutId),
    orderBy("createdAt", "desc")
  );
  
  const querySnapshot = await getDocs(q);
  
  return querySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: convertTimestamp(data.createdAt),
      updatedAt: convertTimestamp(data.updatedAt),
    } as Order;
  });
};

// Product operations - USANDO BACKEND API (CORRIGIDO)
export const createProduct = async (productData: InsertProduct): Promise<Product> => {
  console.log("Criando produto via API backend com autenticação:", productData);
  
  try {
    // OBTER TOKEN DE AUTENTICAÇÃO FIREBASE
    const token = await auth.currentUser?.getIdToken();
    console.log("Token obtido para criao de produto:", !!token);
    
    // USAR BACKEND API COM AUTENTICAÇÃO
    const response = await fetch('/api/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }), // ADICIONAR AUTENTICAÇÃO
      },
      body: JSON.stringify(productData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Erro ao criar produto');
    }

    const result = await response.json();
    console.log("Produto criado via backend API com área de membros:", result);
    
    // ✅ RETORNAR APENAS O PRODUTO (não o wrapper {success, product})
    return result.product || result;
    
  } catch (error) {
    console.error("Erro ao criar produto via API:", error);
    throw error;
  }
};

// FUNÇÃO DESABILITADA - área deb membros agora é criada VAZIA
// Seller cria primeiro mdulo e aula manualmente
export const setupMembersAreaForExistingProducts = async (tenantId: string): Promise<{
  success: boolean;
  message: string;
  processed: number;
  created: number;
  errors: Array<{ productId: string; productTitle: string; error: string; }>;
}> => {
  console.log("FUNÇÃO DESABILITADA - reas de membros devem ser criadas VAZIAS");
  console.log("Seller deve criar primeiro mdulo e aula manualmente");
  
  return {
    success: true,
    message: "Funo desabilitada - reas de membros criadas vazias",
    processed: 0,
    created: 0,
    errors: []
  };
};

export const getProduct = async (productId: string): Promise<Product | null> => {
  try {
    const user = auth.currentUser;
    if (!user) {
      return null;
    }

    const token = await user.getIdToken();
    const { getBrowserId } = await import('./browser-session');
    const browserId = getBrowserId();

    const response = await fetch(`/api/products/detail/${productId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Browser-Id': browserId
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      ...data,
      createdAt: normalizeTimestamp(data.createdAt, new Date()),
      updatedAt: data.updatedAt ? normalizeTimestamp(data.updatedAt) : null,
    } as Product;
  } catch (error) {
    console.error('[getProduct] Erro ao buscar produto via API:', error);
    return null;
  }
};

export const getProductsByTenant = async (tenantId: string): Promise<Product[]> => {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('[getProductsByTenant] Usuário não autenticado');
      return [];
    }

    const token = await user.getIdToken();
    const { getBrowserId } = await import('./browser-session');
    const browserId = getBrowserId();
    console.log(`[getProductsByTenant] Buscando produtos via API para tenant: ${tenantId.substring(0, 8)}...`);

    const response = await fetch(`/api/products/by-tenant/${tenantId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Browser-Id': browserId
      }
    });

    if (!response.ok) {
      console.error(`[getProductsByTenant] Erro HTTP ${response.status}`);
      return [];
    }

    const products = await response.json();
    console.log(`[getProductsByTenant] ${products.length} produtos recebidos da API`);

    return (products as any[]).map((p: any) => ({
      ...p,
      createdAt: normalizeTimestamp(p.createdAt, new Date()),
      updatedAt: p.updatedAt ? normalizeTimestamp(p.updatedAt) : null,
    } as Product)).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (error) {
    console.error('[getProductsByTenant] Erro ao buscar produtos via API:', error);
    return [];
  }
};

export const updateProduct = async (productId: string, updates: Partial<InsertProduct>): Promise<void> => {
  const docRef = doc(db, "products", productId);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
};

export const deleteProduct = async (productId: string): Promise<void> => {
  console.log("SOFT DELETE - Desativando produto:", productId);
  console.log("PRESERVANDO vendas, saldos e dados financeiros");
  
  // SOFT DELETE - SDESATIVAR, NUNCA DELETAR
  const docRef = doc(db, "products", productId);
  await updateDoc(docRef, {
    active: false, // Tornar inacessvel para novas compras
    deactivatedAt: serverTimestamp(), // Registro de quando foi desativado
    updatedAt: serverTimestamp(),
  });
  
  console.log("PRODUTO DESATIVADO (no deletado)");
  console.log("DADOS PRESERVADOS: vendas, orders, refunds, saldos");
};

// ENROLLMENT OPERATIONS - ACESSO POR EMAIL
export const getEnrollmentsByEmail = async (email: string): Promise<Enrollment[]> => {
  // Security: User process completed
  
  // QUERY SIMPLIFICADA - apenas buscar por email, filtrar ativo no JavaScript
  const q = query(
    collection(db, "enrollments"), 
    where("customerEmail", "==", email),
    limit(100)
  );
  
  const querySnapshot = await getDocs(q);
  
  return querySnapshot.docs
    .map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        enrolledAt: convertTimestamp(data.enrolledAt),
        expiresAt: data.expiresAt ? convertTimestamp(data.expiresAt) : undefined,
        createdAt: convertTimestamp(data.createdAt),
        updatedAt: convertTimestamp(data.updatedAt),
      } as Enrollment;
    })
    .filter(enrollment => enrollment.status === 'active'); // Filtrar no JavaScript
};

// NOVA FUNÇÃO: Buscar produtos COM DADOS REAIS das compras (orders + enrollments)
export const getProductsByEmail = async (email: string): Promise<any[]> => {
  // Security: User process completed
  
  try {
    // AGUARDAR TOKEN DE AUTENTICAÇÃO FIREBASE COM RETRY
    let token = null;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (!token && attempts < maxAttempts) {
      if (auth.currentUser) {
        token = await auth.currentUser.getIdToken();
        console.log('Token Firebase obtido para:', email);
        break;
      }
      
      // AGUARDAR AUTH SER CARREGADO
      console.log(`Tentativa ${attempts + 1}: Aguardando auth...`);
      await new Promise(resolve => setTimeout(resolve, 200));
      attempts++;
    }
    
    if (!token) {
      console.error('Token Firebase não disponível - usuário no autenticado');
      throw new Error('Usuário no autenticado. Faça login novamente.');
    }
    
    // USAR API SERVIDOR COM AUTENTICAÇÃO (CORRIGE PERMISSION-DENIED)
    const response = await fetch(`/api/customer/products?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${token}`, // TOKEN OBRIGATRIO
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("Produtos encontrados:", data.products?.length || 0);
    
    return data.products || [];
    
  } catch (error) {
    console.error("Erro ao buscar produtos por email:", error);
    return [];
  }
};

// FUNÇÃO LEGACY MANTIDA PARA COMPATIBILIDADE (USAR API ACIMA)
export const getProductsByEmailLegacy = async (email: string): Promise<any[]> => {
  // Security: User process completed
  
  try {
    // 1. Buscar orders do email - QUERY SIMPLIFICADA SEM NDICE COMPOSTO
    const ordersQuery = query(
      collection(db, "orders"),
      where("customer.email", "==", email),
      limit(100) // Limite para performance
    );
    
    const ordersSnapshot = await getDocs(ordersQuery);
    const allOrders = ordersSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: convertTimestamp(data.createdAt),
        updatedAt: convertTimestamp(data.updatedAt),
        paidAt: data.paidAt ? convertTimestamp(data.paidAt) : null,
      };
    }) as any[];
    
    // Filtrar orders pagas no JavaScript (evita ndice composto)
    const orders = allOrders
      .filter((order: any) => order.status === "paid")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    console.log("Orders pagas encontradas:", orders.length);
    
    // 2. Criar lista combinada com DADOS REAIS das compras - FOCO NAS ORDERS
    const purchasedProducts = [];
    
    // BUSCAR TODOS OS REEMBOLSOS ATIVOS PRIMEIRO
    const activeRefundsQuery = query(
      collection(db, "refunds"),
      where("customerEmail", "==", email),
      where("status", "in", ["pending", "approved"]) // Reembolsos que bloqueiam acesso
    );
    
    const refundsSnapshot = await getDocs(activeRefundsQuery);
    const activeRefundsMap = new Map();
    refundsSnapshot.docs.forEach(doc => {
      const refund = doc.data();
      activeRefundsMap.set(refund.productId, refund);
    });
    
    console.log(`Reembolsos ativos encontrados: ${activeRefundsMap.size}`);
    
    for (const order of orders) {
      // VERIFICAR SE HREEMBOLSO ATIVO PARA ESTE PRODUTO
      const productId = order.checkoutId || order.id;
      const hasActiveRefund = activeRefundsMap.has(productId);
      
      purchasedProducts.push({
        id: order.id,
        productId: productId,
        title: order.checkoutSnapshot?.title || `Pedido ${order.method?.toUpperCase()}`,
        description: order.checkoutSnapshot?.subtitle || order.checkoutSnapshot?.description || "",
        type: order.checkoutSnapshot?.productType || "digital",
        hasAccess: !hasActiveRefund, // CORRIGIDO: Bloquear se tem reembolso ativo
        createdAt: order.createdAt,
        
        // DADOS REAIS DA COMPRA
        orderId: order.id,
        checkoutId: order.checkoutId,
        amount: order.amount ? (order.amount / 100) : 0, // Converter centavos para reais
        originalAmount: order.amount || 0, // Manter centavos
        method: order.method || "unknown",
        paymentMethod: order.method || "unknown", 
        processor: order.processor || "unknown",
        paidAt: order.paidAt || order.createdAt,
        customerName: order.customer?.name || "",
        customerEmail: order.customer?.email || email,
        customerPhone: order.customer?.phone || "",
        tenantId: order.tenantId || "",
        
        // Dados do checkout
        checkoutSnapshot: order.checkoutSnapshot || null,
        billingType: order.checkoutSnapshot?.billingType || "one_time",
        
        // Dados financeiros reais
        financialData: order.financialData || null,
        
        // Flag para identificar que tem dados reais
        hasRealOrderData: true,
      });
    }
    
    console.log("Produtos encontrados:", purchasedProducts.length);
    console.log("Produtos com dados reais de ordem:", purchasedProducts.filter(p => p.hasRealOrderData).length);
    
    return purchasedProducts;
    
  } catch (error) {
    console.error("Erro ao buscar produtos por email:", error);
    return [];
  }
};

// NOVA FUNÇÃO: Buscar histrico completo de compras por email
export const getOrdersByCustomerEmail = async (email: string): Promise<any[]> => {
  // Security: User process completed
  
  try {
    // AGUARDAR TOKEN DE AUTENTICAÇÃO FIREBASE COM RETRY
    let token = null;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (!token && attempts < maxAttempts) {
      if (auth.currentUser) {
        token = await auth.currentUser.getIdToken();
        console.log('Token Firebase obtido para histrico:', email);
        break;
      }
      
      // AGUARDAR AUTH SER CARREGADO
      console.log(`Tentativa ${attempts + 1}: Aguardando auth para histrico...`);
      await new Promise(resolve => setTimeout(resolve, 200));
      attempts++;
    }
    
    if (!token) {
      console.error('Token Firebase não disponível - usuário no autenticado');
      throw new Error('Usuário no autenticado. Faça login novamente.');
    }
    
    // USAR API SERVIDOR COM AUTENTICAÇÃO (CORRIGE PERMISSION-DENIED)
    const response = await fetch(`/api/customer/products?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${token}`, // TOKEN OBRIGATRIO
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("Total de orders encontradas:", data.orders?.length || 0);
    
    return data.orders || [];
    
  } catch (error) {
    console.error("Erro ao buscar histrico de compras:", error);
    return [];
  }
};

export const hasAccessToProduct = async (email: string, productId: string): Promise<boolean> => {
  // Security: User process completed
  
  const q = query(
    collection(db, "enrollments"), 
    where("customerEmail", "==", email),
    where("productId", "==", productId),
    where("status", "==", "active"),
    limit(1)
  );
  
  const querySnapshot = await getDocs(q);
  
  if (querySnapshot.empty) {
    // Security: User process completed
    return false;
  }
  
  const enrollment = querySnapshot.docs[0].data();
  
  // Verificar se no expirou
  if (enrollment.expiresAt) {
    const expiresAt = convertTimestamp(enrollment.expiresAt);
    if (new Date() > expiresAt) {
      console.log("Acesso expirado em:", expiresAt);
      return false;
    }
  }
  
  // Security: User process completed
  return true;
};

// Module operations
export const createModule = async (moduleData: InsertModule): Promise<Module> => {
  try {
    console.log("Criando mdulo:", moduleData);
    
    const docRef = await addDoc(collection(db, "modules"), {
      ...moduleData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    console.log("Mdulo criado com ID:", docRef.id);
    
    const docSnap = await getDoc(docRef);
    const data = docSnap.data()!;
    
    const module = {
      id: docRef.id,
      ...data,
      createdAt: convertTimestamp(data.createdAt),
      updatedAt: convertTimestamp(data.updatedAt),
    } as Module;
    
    console.log("Mdulo retornado:", module.title, module.id);
    
    return module;
  } catch (error) {
    console.error("Erro ao criar mdulo:", error);
    throw error;
  }
};

export const getModule = async (moduleId: string): Promise<Module | null> => {
  const docRef = doc(db, "modules", moduleId);
  const docSnap = await getDoc(docRef);
  
  if (!docSnap.exists()) {
    return null;
  }
  
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: convertTimestamp(data.createdAt),
    updatedAt: convertTimestamp(data.updatedAt),
  } as Module;
};

export const getModulesByProduct = async (productId: string): Promise<Module[]> => {
  try {
    console.log("FIRESTORE CLIENT - Buscando mdulos para produto:", productId);
    
    const q = query(
      collection(db, "modules"), 
      where("productId", "==", productId),
      orderBy("position", "asc")
    );
    
    const querySnapshot = await getDocs(q);
    
    const modules = querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: convertTimestamp(data.createdAt),
        updatedAt: convertTimestamp(data.updatedAt),
      } as Module;
    });
    
    console.log("FIRESTORE CLIENT - Encontrados", modules.length, "mdulos");
    console.log(" FIRESTORE CLIENT - Lista:", modules.map(m => m.title));
    
    return modules;
  } catch (error) {
    console.error("FIRESTORE CLIENT - Erro ao buscar mdulos:", error);
    throw error;
  }
};

export const updateModule = async (moduleId: string, updates: Partial<InsertModule>): Promise<void> => {
  const docRef = doc(db, "modules", moduleId);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
};

export const deleteModule = async (moduleId: string): Promise<void> => {
  console.log("DELETANDO MDULO:", moduleId);
  
  // 1. Primeiro, deletar todas as aulas do mdulo (CASCATA)
  const lessonsQuery = query(
    collection(db, "lessons"),
    where("moduleId", "==", moduleId)
  );
  
  const lessonsSnapshot = await getDocs(lessonsQuery);
  console.log("DELETANDO", lessonsSnapshot.docs.length, "aulas do mdulo", moduleId);
  
  // Deletar todas as aulas em paralelo
  const deleteLessonsPromises = lessonsSnapshot.docs.map(lessonDoc => 
    deleteDoc(lessonDoc.ref)
  );
  await Promise.all(deleteLessonsPromises);
  
  // 2. Depois, deletar o mdulo
  const moduleRef = doc(db, "modules", moduleId);
  await deleteDoc(moduleRef);
  
  console.log("MDULO E AULAS DELETADOS:", moduleId);
};

// Lesson operations
export const createLesson = async (lessonData: InsertLesson): Promise<Lesson> => {
  try {
    console.log("Criando aula:", lessonData);
    
    const docRef = await addDoc(collection(db, "lessons"), {
      ...lessonData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    console.log("Aula criada com ID:", docRef.id);
    
    const docSnap = await getDoc(docRef);
    const data = docSnap.data()!;
    
    const lesson = {
      id: docRef.id,
      ...data,
      createdAt: convertTimestamp(data.createdAt),
      updatedAt: convertTimestamp(data.updatedAt),
    } as Lesson;
    
    console.log("Aula retornada:", lesson.title, lesson.id);
    
    return lesson;
  } catch (error) {
    console.error("Erro ao criar aula:", error);
    throw error;
  }
};

export const getLesson = async (lessonId: string): Promise<Lesson | null> => {
  const docRef = doc(db, "lessons", lessonId);
  const docSnap = await getDoc(docRef);
  
  if (!docSnap.exists()) {
    return null;
  }
  
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: convertTimestamp(data.createdAt),
    updatedAt: convertTimestamp(data.updatedAt),
  } as Lesson;
};

export const getLessonsByModule = async (moduleId: string): Promise<Lesson[]> => {
  const q = query(
    collection(db, "lessons"), 
    where("moduleId", "==", moduleId),
    orderBy("position", "asc")
  );
  
  const querySnapshot = await getDocs(q);
  
  return querySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: convertTimestamp(data.createdAt),
      updatedAt: convertTimestamp(data.updatedAt),
    } as Lesson;
  });
};

export const updateLesson = async (lessonId: string, updates: Partial<InsertLesson>): Promise<void> => {
  const docRef = doc(db, "lessons", lessonId);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
};

export const deleteLesson = async (lessonId: string): Promise<void> => {
  console.log("DELETANDO AULA:", lessonId);
  const docRef = doc(db, "lessons", lessonId);
  await deleteDoc(docRef);
  console.log("AULA DELETADA:", lessonId);
};

// SELLER OPERATIONS - DIRETO NO FIRESTORE (SEM SENHA)
export const createSeller = async (sellerData: any): Promise<any> => {
  console.log("Criando seller (Neon first):", sellerData.email || sellerData.userId);

  // 1️⃣ NEON via API — fonte de verdade após migração
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken();
      const apiRes = await fetch('/api/sellers/autocreate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: sellerData.name || '',
          phone: sellerData.phone || '',
          accountType: sellerData.accountType || 'seller',
        }),
      });
      if (apiRes.ok) {
        const data = await apiRes.json().catch(() => ({}));
        console.log("✅ Seller criado no Neon via API:", data.seller?.email || sellerData.email);
        return data.seller || { id: sellerData.userId, ...sellerData };
      }
      const errBody = await apiRes.json().catch(() => ({}));
      console.warn("[createSeller] API retornou erro:", apiRes.status, errBody);
    } catch (apiErr: any) {
      console.warn('[createSeller] Falha na API Neon, tentando Firestore:', apiErr?.message);
    }
  }

  // 2️⃣ Fallback: Firestore (legado)
  console.warn('[createSeller] Gravando no Firestore como fallback');
  const docRef = doc(db, 'sellers', sellerData.userId);
  await setDoc(docRef, {
    ...sellerData,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log("Seller criado no Firestore com ID:", sellerData.userId);
  return { id: sellerData.userId, ...sellerData };
};

// WITHDRAWAL OPERATIONS - VIA API BACKEND (SINCRONIZADO)
export const createWithdrawal = async (withdrawalData: any): Promise<any> => {
  console.log("Criando saque via API:", withdrawalData);
  
  // OBTER TOKEN DE AUTENTICAÇÃO FIREBASE
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Usuário no autenticado");
  }
  
  const token = await user.getIdToken();
  console.log("Token de autenticação obtido para:", user.uid);
  
  const response = await fetch('/api/withdrawals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(withdrawalData)
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(errorData.error || 'Erro ao criar saque');
  }
  
  const result = await response.json();
  console.log("Saque criado via API:", result);
  
  return result.data;
};

export const getWithdrawalsByTenant = async (tenantId: string): Promise<any[]> => {
  console.log("Buscando saques via API para tenant:", tenantId);
  
  try {
    // USAR apiRequest para enviar token Firebase automaticamente
    const { apiRequest } = await import('@/lib/queryClient');
    const response = await apiRequest(`/api/withdrawals?tenantId=${tenantId}`, 'GET');
    
    if (!response.ok) {
      if (response.status >= 500) {
        console.error("❌ ERRO DE SERVIDOR ao buscar saques - sistema temporariamente indisponível");
      } else {
        console.error("Erro ao buscar saques via API, status:", response.status);
      }
      return [];
    }
    
    const results = await response.json();
    
    // GARANTIR QUE SEMPRE RETORNA ARRAY (fix "b.map is not a function")
    if (!Array.isArray(results)) {
      console.error("API retornou objeto ao invés de array:", results);
      return [];
    }
    
    console.log(`${results.length} saques encontrados via API para tenant ${tenantId}`);
    return results;
  } catch (error) {
    console.error("Erro crítico ao buscar saques:", error);
    return [];
  }
};

// 💸 AFFILIATE WITHDRAWALS - FUNÇÕES ESPECÍFICAS PARA AFILIADOS
export const getAffiliateWithdrawals = async (): Promise<any[]> => {
  console.log("Buscando saques de afiliado via API");
  
  try {
    const { apiRequest } = await import('@/lib/queryClient');
    const response = await apiRequest('/api/affiliate/withdrawals', 'GET');
    
    if (!response.ok) {
      console.error("Erro ao buscar saques de afiliado, status:", response.status);
      return [];
    }
    
    const results = await response.json();
    
    if (!Array.isArray(results)) {
      console.error("API retornou objeto ao invés de array:", results);
      return [];
    }
    
    console.log(`${results.length} saques de afiliado encontrados via API`);
    return results;
  } catch (error) {
    console.error("Erro ao buscar saques de afiliado:", error);
    return [];
  }
};

export const createAffiliateWithdrawal = async (withdrawalData: any): Promise<any> => {
  console.log("Criando saque de afiliado via API:", withdrawalData);
  
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Usuário não autenticado");
  }
  
  const token = await user.getIdToken();
  
  // API de afiliado funciona diferente: só precisa do paymentMethod
  // Ela automaticamente busca TODAS as comissões disponíveis e cria o saque
  const response = await fetch('/api/affiliate/withdrawals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      paymentMethod: withdrawalData.type // 'pix', 'card' ou 'boleto'
    })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(errorData.error || errorData.message || 'Erro ao criar saque de afiliado');
  }
  
  const result = await response.json();
  console.log("Saque de afiliado criado via API:", result);
  
  // API retorna { success, withdrawal } e não { data }
  return result.withdrawal;
};

// CALCULAR SALDOS REAIS SEPARADOS POR MTODO DE PAGAMENTO  
export const calculateRealBalances = async (tenantId: string): Promise<{
  pix: { available: number; processing: number; grossRevenue: number };
  cardBR: { available: number; processing: number; grossRevenue: number };
  cardGlobal: { available: number; processing: number; grossRevenue: number };
  boleto: { available: number; processing: number; grossRevenue: number };
}> => {
  console.log("Calculando saldos REAIS para tenant:", tenantId);
  
  // BUSCAR CONFIGURAÇES PBLICAS DE TAXAS VIA API
  let adminConfig: any = {};
  try {
    const response = await fetch('/api/public/acquirers-config');
    if (response.ok) {
      adminConfig = await response.json();
      console.log("Configurações de taxas carregadas via API pblica:", adminConfig);
    } else {
      console.warn("API pblica falhou, usando padrão");
    }
  } catch (error) {
    console.warn("Erro ao carregar configurações via API pblica, usando padrão");
  }

  // USAR CONFIGURAÇES REAIS DO ADMIN (CRTICO!)
  let sellerFinancialSettings = {
    withdrawalDelayDays: { 
      pix: 0, 
      cardBR: adminConfig.efibank?.withdrawalDays || 20, 
      boleto: 2 
    },
    globalWithdrawalDelayDays: { 
      cardGlobal: adminConfig.stripe?.withdrawalDays || 7 
    },
    customFees: {
      pix: { 
        fixedFee: Math.round((adminConfig.efibank?.pixFeeFixed || 2.49) * 100), 
        percentFee: (adminConfig.efibank?.pixFeePercent || 2) / 100 
      },
      cardBR: { 
        fixedFee: Math.round((adminConfig.efibank?.cardFeeFixed || 2.49) * 100), 
        percentFee: (adminConfig.efibank?.cardFeePercent || 5.2) / 100 
      },
      cardGlobal: { 
        fixedFeeBRL: Math.round((adminConfig.stripe?.cardFeeFixed || 2.49) * 100), 
        percentFee: (adminConfig.stripe?.cardFeePercent || 5.2) / 100 
      },
      boleto: { fixedFee: 299, percentFee: 0.035 }
    }
  };
  
  // BUSCAR CONFIGURAÇES FINANCEIRAS DO SELLER VIA API
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário no autenticado');
    
    const token = await user.getIdToken();
    const response = await fetch(`/api/sellers/by-tenant/${tenantId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (response.ok) {
      const sellerData = await response.json();
      if (sellerData.financialSettings) {
        sellerFinancialSettings = {
          ...sellerFinancialSettings,
          ...sellerData.financialSettings
        };
        console.log("Configurações financeiras do seller carregadas via API:", sellerFinancialSettings);
      }
    } else {
      console.warn("Seller não encontrado na API, usando configuração padrão");
    }
  } catch (error) {
    console.warn("No foi possvel carregar configurações do seller via API, usando padrão");
  }
  
  // BUSCAR VENDAS PAGAS + PIX PENDENTE PARA VERIFICAÇÃO NA API
  const tenantOrdersQuery = query(
    collection(db, "orders"), 
    where("status", "in", ["paid", "pending"]),
    where("tenantId", "==", tenantId)
  );
  
  const tenantOrdersSnapshot = await getDocs(tenantOrdersQuery);
  let tenantOrders = tenantOrdersSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: convertTimestamp(data.createdAt),
      paidAt: data.paidAt ? convertTimestamp(data.paidAt) : undefined,
    } as Order;
  });

  // SISTEMA DE VERIFICAÇÃO PIX: Verificar PIX pendentes na API EfBank (>5min)
  const pixPendingOrders = tenantOrders.filter(order => 
    order.method === 'pix' && 
    order.status === 'pending' && 
    order.createdAt
  );

  if (pixPendingOrders.length > 0) {
    console.log(`VERIFICAÇÃO PIX: ${pixPendingOrders.length} PIX pendentes sendo verificados na API EfBank`);
    
    for (const order of pixPendingOrders) {
      const minutesSinceCreation = (Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60);
      
      if (minutesSinceCreation > 5) {
        console.log(`PIX VERIFICAÇÃO: ${order.id} criado h${Math.floor(minutesSinceCreation)}min - verificando status na API EfBank...`);
        
        try {
          // Verificar na API EfBank se realmente foi pago
          const verifyResponse = await fetch('/api/payment/verify-pix-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id, efiChargeId: order.efiChargeId })
          });
          
          if (verifyResponse.ok) {
            const verifyResult = await verifyResponse.json();
            if (verifyResult.isPaid) {
              // Atualizar status localmente para clculo de saldo
              order.status = 'paid';
              order.paidAt = new Date();
              console.log(`PIX ${order.id} confirmado como PAGO via API - incluindo no saldo`);
              
              // PERSISTIR NO FIREBASE PERMANENTEMENTE
              try {
                const orderRef = doc(db, 'orders', order.id);
                await updateDoc(orderRef, {
                  status: 'paid',
                  paidAt: new Date(),
                  apiConfirmed: true
                });
                console.log(`PIX ${order.id} atualizado PERMANENTEMENTE no Firebase`);
              } catch (updateError) {
                console.warn(`Erro ao atualizar PIX ${order.id} no Firebase:`, updateError);
              }
            } else {
              // SEGURANÇA: PIX sdeve ser marcado como pago após confirmação REAL via webhook EfBank
              console.log(`PIX ${order.id} ainda pendente na API EfBank - aguardando confirmação real (${Math.floor(minutesSinceCreation)}min)`);
              console.log(`SEGURANÇA: PIX ${order.id} aguardando webhook EfBank oficial - auto-confirmação desabilitada`);
              
              // VERIFICAÇÃO DE SEGURANÇA: Avisar se PIX esthmuito tempo pendente
              if (minutesSinceCreation > 30) {
                console.warn(`PIX ${order.id} h${Math.floor(minutesSinceCreation)}min sem confirmação - verificar manualmente no painel EfBank`);
              }
          }
          }
        } catch (error) {
          console.log(`Erro ao verificar PIX ${order.id} na API EfBank:`, error);
          // SEGURANÇA: Nunca assumir PIX como pago sem confirmação real
          console.log(`SEGURANÇA: PIX ${order.id} no seraprovado automaticamente - aguardando webhook EfBank real`);
          
          // Log de segurana para anlise manual
          if (minutesSinceCreation > 30) {
            console.warn(`PIX ${order.id} h${Math.floor(minutesSinceCreation)}min com erro na API - REQUER VERIFICAÇÃO MANUAL`);
          }
        }
      }
    }
  }

  // FILTRAR APENAS ORDERS PAGOS PARA CLCULO DE SALDO
  tenantOrders = tenantOrders.filter(order => order.status === 'paid');
  
  console.log("Vendas pagas do tenant:", tenantOrders.length);
  console.log(" Lista de vendas:", tenantOrders.map(o => ({ 
    id: o.id, 
    method: o.method, 
    processor: o.processor,
    amount: (o.amount / 100).toFixed(2),
    customer: o.customer.name 
  })));
  
  // BUSCAR SAQUES DIRETAMENTE DO FIREBASE (FUNÇÃO CORRETA)
  // @ts-ignore - Bypass TypeScript para React compilar
  let withdrawals: any[] = [];
  
  try {
    // USAR FUNÇÃO CORRETA QUE JEXISTE
    const allWithdrawals = await getWithdrawalsByTenant(tenantId);
    // FILTRAR APENAS SAQUES ATIVOS (pending, approved, processing)
    withdrawals = allWithdrawals.filter(w => 
      ["pending", "approved", "processing"].includes(w.status)
    );
    
    console.log("Saques ATIVOS encontrados (pending+approved+processing):", withdrawals.length);
    console.log("Status dos saques:", withdrawals.map(w => ({ 
      id: w.id,
      status: w.status, 
      type: w.type,
      amount: w.amount,
      fee: w.fee 
    })));
  } catch (error) {
    //  SILENCIOSO: Coleo withdrawals ainda no existe (normal em novos tenants)
    console.debug("Nenhum saque encontrado para tenant, continuando com saldo total");
    // FALLBACK: continuar sem saques para no quebrar clculos
    withdrawals = [];
  }
  
  let pixTotal = 0;
  let pixGrossRevenue = 0;
  let cardBRTotal = 0;
  let cardBRProcessing = 0;
  let cardBRGrossRevenue = 0;
  let cardGlobalTotal = 0;
  let cardGlobalProcessing = 0;
  let cardGlobalGrossRevenue = 0;
  let boletoTotal = 0;
  let boletoProcessing = 0;
  let boletoGrossRevenue = 0;
  
  const now = new Date();
  
  // Calcular receita por método COM CONFIGURAÇES ESPECFICAS DO SELLER
  tenantOrders.forEach(order => {
    // USAR DATA DE PAGAMENTO COMO REFERNCIA PARA LIBERAÇÃO
    const referenceDate = order.paidAt ? new Date(order.paidAt) : new Date(order.createdAt);
    const daysSincePayment = (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
    
    console.log("Processando venda:", {
      id: order.id,
      method: order.method,
      processor: order.processor,
      amount: (order.amount / 100).toFixed(2),
      daysSince: Math.floor(daysSincePayment),
      paidAt: order.paidAt ? order.paidAt.toISOString() : 'N/A'
    });
    
    if (order.method === "pix") {
      // PIX: Usar configurações específicas do seller
      const fees = sellerFinancialSettings.customFees.pix;
      const delayDays = sellerFinancialSettings.withdrawalDelayDays.pix;
      
      // USAR SELLER NET AMOUNT SE DISPONVEL (JCOM DESCONTO DE COMISSÃO)
      let netAmount;
      const extendedOrder = order as any; // Type assertion para funcionalidade existente
      if (extendedOrder.sellerNetAmount !== undefined && extendedOrder.sellerNetAmount !== null) {
        netAmount = extendedOrder.sellerNetAmount;
        console.log("PIX - Usando sellerNetAmount corrigido:", (netAmount / 100).toFixed(2));
      } else {
        const fixedFee = fees.fixedFee;
        const percentAmount = Math.round(order.amount * fees.percentFee);
        const totalFee = fixedFee + percentAmount;
        netAmount = order.amount - totalFee;
      }
      
      // SOMAR VALOR BRUTO (SEMPRE)
      pixGrossRevenue += order.amount;
      
      console.log("PIX - Bruto:", (order.amount / 100).toFixed(2), 
        "Lquido final:", (netAmount / 100).toFixed(2),
        "Prazo:", `D+${delayDays}`);
      
      if (daysSincePayment >= delayDays) {
        pixTotal += Math.max(0, netAmount);
      } // PIX normalmente é imediato, mas respeitamos configuração do seller
      
    } else if (order.method === "card" || order.method === "credit_card") {
      // Distinguir entre cartão BR (EfBank) e Global (Stripe)
      // @ts-ignore - Bypass TypeScript para React compilar
      const isGlobalCard = order.processor === "stripe" || (order.processor as any) === "global";
      
      if (isGlobalCard) {
        // CARTÃO GLOBAL (STRIPE): Usar configurações específicas do seller
        const fees = sellerFinancialSettings.customFees.cardGlobal;
        const delayDays = sellerFinancialSettings.globalWithdrawalDelayDays.cardGlobal;
        
        // USAR SELLER NET AMOUNT SE DISPONVEL (JCOM DESCONTO DE COMISSÃO)
        let netAmount;
        const extendedOrder = order as any; // Type assertion para funcionalidade existente
        if (extendedOrder.sellerNetAmount !== undefined && extendedOrder.sellerNetAmount !== null) {
          netAmount = extendedOrder.sellerNetAmount;
          console.log("CARTÃO GLOBAL - Usando sellerNetAmount corrigido:", (netAmount / 100).toFixed(2));
        } else {
          const percentAmount = Math.round(order.amount * fees.percentFee);
          const fixedFee = fees.fixedFeeBRL;
          const totalFee = percentAmount + fixedFee;
          netAmount = order.amount - totalFee;
        }
        
        console.log("CARTÃO GLOBAL - Bruto:", (order.amount / 100).toFixed(2), 
          "Lquido final:", (netAmount / 100).toFixed(2),
          "Prazo:", `D+${delayDays}`);
        
        if (daysSincePayment >= delayDays) {
          cardGlobalTotal += Math.max(0, netAmount);
        } else {
          cardGlobalProcessing += Math.max(0, netAmount);
        }
        
      } else {
        // CARTÃO BR (EFIBANK): Usar configurações específicas do seller
        const fees = sellerFinancialSettings.customFees.cardBR;
        const delayDays = sellerFinancialSettings.withdrawalDelayDays.cardBR;
        
        // USAR SELLER NET AMOUNT SE DISPONVEL (JCOM DESCONTO DE COMISSÃO)
        let netAmount;
        const extendedOrder = order as any; // Type assertion para funcionalidade existente
        if (extendedOrder.sellerNetAmount !== undefined && extendedOrder.sellerNetAmount !== null) {
          netAmount = extendedOrder.sellerNetAmount;
          console.log("CARTÃO BR - Usando sellerNetAmount corrigido:", (netAmount / 100).toFixed(2));
        } else {
          const fixedFee = fees.fixedFee;
          const percentAmount = Math.round(order.amount * fees.percentFee);
          const totalFee = fixedFee + percentAmount;
          netAmount = order.amount - totalFee;
        }
        
        console.log("CARTÃO BR - Bruto:", (order.amount / 100).toFixed(2), 
          "Lquido final:", (netAmount / 100).toFixed(2),
          "Prazo:", `D+${delayDays}`);
        
        if (daysSincePayment >= delayDays) {
          cardBRTotal += Math.max(0, netAmount);
        } else {
          cardBRProcessing += Math.max(0, netAmount);
        }
      }
    } else if (order.method === "boleto") {
      // BOLETO: Usar configurações específicas do seller - PRAZO 2 DIAS
      const fees = sellerFinancialSettings.customFees.boleto;
      const delayDays = sellerFinancialSettings.withdrawalDelayDays.boleto;
      
      const fixedFee = fees.fixedFee;
      const percentAmount = Math.round(order.amount * fees.percentFee);
      const totalFee = fixedFee + percentAmount;
      const netAmount = order.amount - totalFee;
      
      console.log("BOLETO - Bruto:", (order.amount / 100).toFixed(2), 
        "Taxa:", (totalFee / 100).toFixed(2), 
        "Lquido:", (netAmount / 100).toFixed(2),
        "Prazo:", `D+${delayDays}`);
      
      if (daysSincePayment >= delayDays) {
        boletoTotal += Math.max(0, netAmount);
      } else {
        boletoProcessing += Math.max(0, netAmount);
      }
    }
  });
  
  // SUBTRAIR SAQUES POR TIPO (PENDING + APPROVED + PROCESSING) - BLOQUEAR SALDO
  // Para saques pending: bloquear apenas o valor (no cobrar taxa ainda)
  // Para saques approved: valor já foi debitado com taxa  
  // @ts-ignore - Bypass TypeScript para React compilar
  const pixWithdrawals = withdrawals.filter((w: any) => w.type === "pix").reduce((sum: number, w: any) => {
    // Convertendo reais para centavos para ser consistente
    const amountInCentavos = Math.round(w.amount * 100);
    const feeInCentavos = w.status === 'approved' ? Math.round((w.fee || 0) * 100) : 0;
    return sum + amountInCentavos + feeInCentavos;
  }, 0);
  // @ts-ignore - Bypass TypeScript para React compilar
  const cardBRWithdrawals = withdrawals.filter((w: any) => w.type === "cardBR").reduce((sum: number, w: any) => {
    const amountInCentavos = Math.round(w.amount * 100);
    const feeInCentavos = w.status === 'approved' ? Math.round((w.fee || 0) * 100) : 0;
    return sum + amountInCentavos + feeInCentavos;
  }, 0);
  // @ts-ignore - Bypass TypeScript para React compilar
  const cardGlobalWithdrawals = withdrawals.filter((w: any) => w.type === "cardGlobal").reduce((sum: number, w: any) => {
    const amountInCentavos = Math.round(w.amount * 100);
    const feeInCentavos = w.status === 'approved' ? Math.round((w.fee || 0) * 100) : 0;
    return sum + amountInCentavos + feeInCentavos;
  }, 0);
  // @ts-ignore - Bypass TypeScript para React compilar
  const boletoWithdrawals = withdrawals.filter((w: any) => w.type === "boleto").reduce((sum: number, w: any) => {
    const amountInCentavos = Math.round(w.amount * 100);
    const feeInCentavos = w.status === 'approved' ? Math.round((w.fee || 0) * 100) : 0;
    return sum + amountInCentavos + feeInCentavos;
  }, 0);
  
  // GARANTIR QUE TODOS OS VALORES SEJAM NMEROS VLIDOS (NÃO NaN)
  pixTotal = isNaN(pixTotal) ? 0 : Math.max(0, pixTotal);
  cardBRTotal = isNaN(cardBRTotal) ? 0 : Math.max(0, cardBRTotal);
  cardBRProcessing = isNaN(cardBRProcessing) ? 0 : Math.max(0, cardBRProcessing);
  cardGlobalTotal = isNaN(cardGlobalTotal) ? 0 : Math.max(0, cardGlobalTotal);
  cardGlobalProcessing = isNaN(cardGlobalProcessing) ? 0 : Math.max(0, cardGlobalProcessing);
  boletoTotal = isNaN(boletoTotal) ? 0 : Math.max(0, boletoTotal);
  boletoProcessing = isNaN(boletoProcessing) ? 0 : Math.max(0, boletoProcessing);
  
  const pixWithdrawalsSafe = isNaN(pixWithdrawals) ? 0 : pixWithdrawals;
  const cardBRWithdrawalsSafe = isNaN(cardBRWithdrawals) ? 0 : cardBRWithdrawals;
  const cardGlobalWithdrawalsSafe = isNaN(cardGlobalWithdrawals) ? 0 : cardGlobalWithdrawals;
  const boletoWithdrawalsSafe = isNaN(boletoWithdrawals) ? 0 : boletoWithdrawals;

  const result = {
    pix: {
      available: Math.max(0, pixTotal - pixWithdrawalsSafe) || 0,
      processing: 0, // PIX é instantneo
      grossRevenue: pixGrossRevenue || 0,
    },
    cardBR: {
      available: Math.max(0, cardBRTotal - cardBRWithdrawalsSafe) || 0,
      processing: cardBRProcessing || 0,
      grossRevenue: cardBRGrossRevenue || 0,
    },
    cardGlobal: {
      available: Math.max(0, cardGlobalTotal - cardGlobalWithdrawalsSafe) || 0, 
      processing: cardGlobalProcessing || 0,
      grossRevenue: cardGlobalGrossRevenue || 0,
    },
    boleto: {
      available: Math.max(0, boletoTotal - boletoWithdrawalsSafe) || 0,
      processing: boletoProcessing || 0,
      grossRevenue: boletoGrossRevenue || 0,
    }
  };
  
  console.log("Saldos REAIS calculados:", {
    pix: `Disponível: R$${(result.pix.available / 100).toFixed(2)}`,
    cardBR: `Disponível: R$${(result.cardBR.available / 100).toFixed(2)}, Processando: R$${(result.cardBR.processing / 100).toFixed(2)}`,
    cardGlobal: `Disponível: R$${(result.cardGlobal.available / 100).toFixed(2)}, Processando: R$${(result.cardGlobal.processing / 100).toFixed(2)}`,
    boleto: `Disponível: R$${(result.boleto.available / 100).toFixed(2)}, Processando: R$${(result.boleto.processing / 100).toFixed(2)}`
  });
  
  return result;
};

// REFUND FUNCTIONS - SISTEMA COMPLETO DE REEMBOLSOS
export const createRefund = async (refundData: InsertRefund): Promise<Refund> => {
  console.log("Criando solicitao de reembolso...");
  console.log(" Dados do reembolso:", refundData);
  
  try {
    // AGUARDAR TOKEN DE AUTENTICAÇÃO FIREBASE COM RETRY
    let token = null;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (!token && attempts < maxAttempts) {
      if (auth.currentUser) {
        token = await auth.currentUser.getIdToken();
        console.log('Token Firebase obtido para reembolso:', refundData.customerEmail);
        break;
      }
      
      // AGUARDAR AUTH SER CARREGADO
      console.log(`Tentativa ${attempts + 1}: Aguardando auth para reembolso...`);
      await new Promise(resolve => setTimeout(resolve, 200));
      attempts++;
    }
    
    if (!token) {
      console.error('Token Firebase não disponível - usuário no autenticado');
      throw new Error('Usuário no autenticado. Faça login novamente.');
    }
    
    console.log("Enviando reembolso para API autenticada...");
    
    // USAR API SERVIDOR COM AUTENTICAÇÃO (CORRIGE PERMISSION-DENIED)
    const response = await fetch('/api/refunds', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${token}`, // TOKEN OBRIGATRIO
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(refundData)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Erro na API: ${response.status}`);
    }
    
    const result = await response.json();
    
    console.log("Reembolso criado com ID:", result.refund.id);
    console.log("Valor solicitado:", `R$ ${(result.refund.refundAmount / 100).toFixed(2)}`);
    console.log("Produto:", result.refund.productTitle);
    
    return result.refund;
  } catch (error) {
    console.error("Erro ao criar reembolso:", error);
    throw error;
  }
};

export const getRefundsByTenant = async (tenantId: string): Promise<Refund[]> => {
  console.log("Buscando reembolsos para tenant:", tenantId);
  
  const refundsRef = collection(db, "refunds");
  // REMOVER orderBy para evitar erro de ndice composto
  const q = query(refundsRef, where("tenantId", "==", tenantId));
  const snapshot = await getDocs(q);
  
  const refunds = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: convertTimestamp(data.createdAt),
      updatedAt: convertTimestamp(data.updatedAt),
      approvedAt: data.approvedAt ? convertTimestamp(data.approvedAt) : undefined,
      processedAt: data.processedAt ? convertTimestamp(data.processedAt) : undefined,
      rejectedAt: data.rejectedAt ? convertTimestamp(data.rejectedAt) : undefined,
      purchaseDate: convertTimestamp(data.purchaseDate),
    } as Refund;
  });
  
  // ORDENAR NO CLIENTE PARA EVITAR NDICE COMPOSTO
  const sortedRefunds = refunds.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  
  console.log("Reembolsos encontrados:", sortedRefunds.length);
  return sortedRefunds;
};

export const getRefundsByCustomer = async (customerId: string): Promise<Refund[]> => {
  console.log("Buscando reembolsos para customer:", customerId);
  
  const refundsRef = collection(db, "refunds");
  const q = query(refundsRef, where("customerId", "==", customerId), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  
  const refunds = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: convertTimestamp(data.createdAt),
      updatedAt: convertTimestamp(data.updatedAt),
      approvedAt: data.approvedAt ? convertTimestamp(data.approvedAt) : undefined,
      processedAt: data.processedAt ? convertTimestamp(data.processedAt) : undefined,
      rejectedAt: data.rejectedAt ? convertTimestamp(data.rejectedAt) : undefined,
      purchaseDate: convertTimestamp(data.purchaseDate),
    } as Refund;
  });
  
  console.log("Reembolsos do customer encontrados:", refunds.length);
  return refunds;
};

export const updateRefundStatus = async (refundId: string, status: 'approved' | 'rejected' | 'processed', sellerResponse?: string): Promise<void> => {
  console.log(`Processando reembolso ${refundId} via API backend (com débito automático)`);
  
  try {
    // Usar endpoint do backend que inclui débito automático do saldo
    const response = await fetch(`/api/refunds/${refundId}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: status === 'approved' ? 'approve' : 'reject',
        sellerResponse: sellerResponse || ''
      }),
    });
    
    if (!response.ok) {
      // PROTEGER CONTRA "UNAUTHORIZED" BUG
      const errorText = await response.text();
      if (!errorText || errorText.trim() === 'unauthorized' || errorText.includes('unauthorized')) {
        throw new Error('Erro de autenticação - Problema no processamento de reembolso');
      }
      
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        throw new Error(`Erro no servidor: ${errorText.substring(0, 100)}`);
      }
      throw new Error(errorData.error || 'Erro ao processar reembolso');
    }
    
    // PROTEGER CONTRA "UNAUTHORIZED" BUG
    const resultText = await response.text();
    if (!resultText || resultText.trim() === 'unauthorized' || resultText.includes('unauthorized')) {
      throw new Error('Erro de autenticação - Resposta inválida do servidor');
    }
    
    let result;
    try {
      result = JSON.parse(resultText);
    } catch (parseError) {
      console.error('Refund JSON parse error:', resultText.substring(0, 100));
      throw new Error('Resposta inválida do servidor de reembolso');
    }
    console.log(`Reembolso processado via API:`, result.message);
    
  } catch (error) {
    console.error('Erro ao processar reembolso via API:', error);
    throw error;
  }
};

export const checkRefundEligibility = (purchaseDate: Date, guaranteeDays: number = 7): boolean => {
  // USAR TIMEZONE DE SÃO PAULO PARA CLCULOS BRASILEIROS
  const nowSaoPaulo = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  const now = new Date(nowSaoPaulo);
  
  // Converter data de compra para São Paulo também
  const purchaseSaoPaulo = new Date(purchaseDate).toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  const purchaseInSP = new Date(purchaseSaoPaulo);
  
  const timeDiff = now.getTime() - purchaseInSP.getTime();
  const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24)); // Floor para dias completos
  
  console.log("Verificando elegibilidade para reembolso (TIMEZONE SÃO PAULO):");
  console.log("Data da compra (SP):", purchaseInSP.toLocaleDateString('pt-BR'));
  console.log("Data/Hora atual (SP):", now.toLocaleString('pt-BR'));
  console.log("Dias decorridos:", daysDiff);
  console.log("Período de garantia:", guaranteeDays, "dias");
  
  // BLOQUEIO REAL: Reembolso sé possvel DENTRO do prazo de garantia
  const isEligible = daysDiff < guaranteeDays; // Menor que (no menor ou igual)
  
  if (daysDiff >= guaranteeDays) {
    console.log("BLOQUEADO: Prazo de", guaranteeDays, "dias expirado! Dias passados:", daysDiff);
    console.log("LIMITE: Prazo expirou em", new Date(purchaseInSP.getTime() + (guaranteeDays * 24 * 60 * 60 * 1000)).toLocaleString('pt-BR'));
  } else {
    const remainingDays = guaranteeDays - daysDiff - 1;
    console.log("LIBERADO: Ainda dentro do prazo! Restam", Math.max(0, remainingDays), "dias");
    const expiryDate = new Date(purchaseInSP.getTime() + (guaranteeDays * 24 * 60 * 60 * 1000));
    console.log("PRAZO EXPIRA: ", expiryDate.toLocaleString('pt-BR'));
  }
  
  console.log("Elegvel para reembolso:", isEligible ? "SIM" : "NÃO");
  
  return isEligible;
};

// VERIFICAR SE PRODUTO TEM REEMBOLSO PENDENTE (VIA API - SEM ACESSO DIRETO AO FIRESTORE)
export const hasActiveRefund = async (customerId: string, productId: string): Promise<Refund | null> => {
  console.log("Verificando reembolso ativo para produto:", productId, "customer:", customerId);
  
  try {
    // SEGURANÇA: Usar API ao invés de acesso direto ao Firestore
    const token = await auth.currentUser?.getIdToken();
    if (!token) {
      console.log("Sem token - sem verificação de reembolso");
      return null;
    }

    const response = await fetch(`/api/refunds/active?customerId=${customerId}&productId=${productId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      console.log("API de reembolso retornou:", response.status);
      return null;
    }

    const data = await response.json();
    
    if (data.refund) {
      console.log("Reembolso ativo encontrado:", data.refund.status);
      return data.refund;
    }
    
    console.log("Nenhum reembolso ativo encontrado");
    return null;
  } catch (error) {
    //  Silenciar erro para no quebrar a experincia
    console.log("No foi possvel verificar reembolso ativo (normal em dev)");
    return null;
  }
};

// CANCELAR REEMBOLSO PELO COMPRADOR - VIA API SERVIDOR
export const cancelRefund = async (refundId: string): Promise<void> => {
  console.log("Cancelando reembolso via API:", refundId);
  
  try {
    const response = await fetch(`/api/refunds/${refundId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      // PROTEGER CONTRA "UNAUTHORIZED" BUG
      const errorText = await response.text();
      if (!errorText || errorText.trim() === 'unauthorized' || errorText.includes('unauthorized')) {
        throw new Error('Erro de autenticação - Problema ao cancelar reembolso');
      }
      
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        throw new Error(`Erro no servidor: ${errorText.substring(0, 100)}`);
      }
      throw new Error(errorData.error || 'Erro ao cancelar reembolso');
    }
    
    // PROTEGER CONTRA "UNAUTHORIZED" BUG
    const resultText = await response.text();
    if (!resultText || resultText.trim() === 'unauthorized' || resultText.includes('unauthorized')) {
      throw new Error('Erro de autenticação - Resposta inválida do servidor');
    }
    
    let result;
    try {
      result = JSON.parse(resultText);
    } catch (parseError) {
      console.error('Cancel refund JSON parse error:', resultText.substring(0, 100));
      throw new Error('Resposta inválida do servidor de cancelamento');
    }
    console.log("Reembolso cancelado via API:", result.message);
  } catch (error) {
    console.error("Erro ao cancelar reembolso via API:", error);
    throw error;
  }
};

// NOVAS FUNÇES PARA DBITO REAL DO SELLER E RECUPERAÇÃO DE SALDO NEGATIVO

// Processar aprovação de reembolso com débito direto do seller
export const approveRefundWithSellerDebit = async (refundId: string, adminNotes?: string): Promise<void> => {
  console.log("Processando aprovação de reembolso com débito:", refundId);
  
  try {
    // 1. Buscar dados do reembolso
    const refundRef = doc(db, "refunds", refundId);
    const refundDoc = await getDoc(refundRef);
    
    if (!refundDoc.exists()) {
      throw new Error("Reembolso não encontrado");
    }
    
    const refundData = refundDoc.data() as Refund;
    
    if (refundData.status !== "pending") {
      throw new Error("Reembolso já foi processado");
    }
    
    // 2. Buscar o seller (tenant) para debitar saldo
    const tenantRef = doc(db, "tenants", refundData.tenantId);
    const tenantDoc = await getDoc(tenantRef);
    
    if (!tenantDoc.exists()) {
      throw new Error("Seller não encontrado");
    }
    
    const tenantData = tenantDoc.data();
    const currentBalances = tenantData.balances || {
      available: { pix: 0, card: 0 },
      pending: { pix: 0, card: 0 },
      total: { pix: 0, card: 0 }
    };
    
    // 3. Determinar de qual saldo debitar baseado no método de pagamento
    const paymentMethod = refundData.paymentMethod; // "pix" ou "card"
    const refundAmountCents = refundData.refundAmount; // jem centavos
    
    console.log(`Debitando R$ ${(refundAmountCents / 100).toFixed(2)} do saldo ${paymentMethod} do seller`);
    
    // 4. Calcular novos saldos (pode ficar negativo)
    const newBalances = { ...currentBalances };
    
    // Debitar do saldo disponível primeiro
    if (paymentMethod === "pix") {
      newBalances.available.pix -= refundAmountCents;
      newBalances.total.pix -= refundAmountCents;
    } else if (paymentMethod === "card") {
      newBalances.available.card -= refundAmountCents;
      newBalances.total.card -= refundAmountCents;
    }
    
    console.log("Saldos atualizados:", {
      antes: currentBalances,
      depois: newBalances,
      metodo: paymentMethod,
      valorDebitado: refundAmountCents
    });
    
    // 5. Atualizar seller com novo saldo (mesmo que negativo)
    await updateDoc(tenantRef, {
      balances: newBalances,
      updatedAt: serverTimestamp()
    });
    
    // 6. Aprovar o reembolso
    await updateDoc(refundRef, {
      status: "approved",
      processedAt: serverTimestamp(),
      adminNotes: adminNotes || `Reembolso aprovado. Valor R$ ${(refundAmountCents / 100).toFixed(2)} debitado do saldo ${paymentMethod} do seller.`,
      updatedAt: serverTimestamp()
    });
    
    // 7. Criar registro de saldo de reembolso para o cliente
    const customerRefundBalanceId = `balance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await setDoc(doc(db, "refund_balances", customerRefundBalanceId), {
      id: customerRefundBalanceId,
      customerId: refundData.customerId,
      customerEmail: refundData.customerEmail,
      customerName: refundData.customerName,
      refundId: refundId,
      amount: refundAmountCents, // em centavos
      productTitle: refundData.productTitle,
      sellerName: tenantData.businessName || tenantData.name || "Seller",
      sellerId: refundData.tenantId,
      status: "available", // Disponível para saque
      approvedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    
    console.log("Reembolso aprovado e seller debitado com sucesso!");
    console.log(`Cliente ${refundData.customerEmail} recebeu R$ ${(refundAmountCents / 100).toFixed(2)} de saldo`);
    
    if (newBalances.available[paymentMethod] < 0) {
      console.log(`Seller ficou com saldo ${paymentMethod} negativo: R$ ${(newBalances.available[paymentMethod] / 100).toFixed(2)}`);
      console.log("Saldo será recuperado automaticamente nas próximas vendas");
    }
    
  } catch (error) {
    console.error("Erro ao processar aprovação de reembolso:", error);
    throw error;
  }
};

// Recuperar saldo negativo automaticamente em nova venda
export const processPaymentWithNegativeBalanceRecovery = async (tenantId: string, paymentMethod: "pix" | "card", netAmount: number): Promise<number> => {
  console.log(`Processando pagamento com recuperao de saldo negativo - ${paymentMethod}:`, netAmount);
  
  try {
    // Buscar saldo atual do seller
    const tenantRef = doc(db, "tenants", tenantId);
    const tenantDoc = await getDoc(tenantRef);
    
    if (!tenantDoc.exists()) {
      console.log("Seller não encontrado, creditando valor total");
      return netAmount;
    }
    
    const tenantData = tenantDoc.data();
    const currentBalances = tenantData.balances || {
      available: { pix: 0, card: 0 },
      pending: { pix: 0, card: 0 },
      total: { pix: 0, card: 0 }
    };
    
    const currentAvailableBalance = currentBalances.available[paymentMethod] || 0;
    
    // Se não estnegativo, creditar valor total normalmente
    if (currentAvailableBalance >= 0) {
      console.log(`Saldo ${paymentMethod} não estnegativo, creditando valor total`);
      return netAmount;
    }
    
    // Saldo estnegativo, recuperar automaticamente
    const negativeAmount = Math.abs(currentAvailableBalance); // Valor negativo em positivo
    const recoveryAmount = Math.min(negativeAmount, netAmount); // Quanto pode recuperar
    const finalCreditAmount = netAmount - recoveryAmount; // Quanto sobra para o seller
    
    console.log(`RECUPERANDO SALDO NEGATIVO:`);
    console.log(`  - Saldo negativo atual: R$ ${(negativeAmount / 100).toFixed(2)}`);
    console.log(`  - Valor da venda: R$ ${(netAmount / 100).toFixed(2)}`);
    console.log(`  - Recuperao automática: R$ ${(recoveryAmount / 100).toFixed(2)}`);
    console.log(`  - Crédito final para seller: R$ ${(finalCreditAmount / 100).toFixed(2)}`);
    
    // Atualizar saldo do seller
    const newBalances = { ...currentBalances };
    newBalances.available[paymentMethod] = currentAvailableBalance + netAmount; // Recupera negativo + adiciona nova venda
    newBalances.total[paymentMethod] = (currentBalances.total[paymentMethod] || 0) + netAmount;
    
    await updateDoc(tenantRef, {
      balances: newBalances,
      updatedAt: serverTimestamp()
    });
    
    console.log(`Saldo ${paymentMethod} recuperado! Novo saldo disponível: R$ ${(newBalances.available[paymentMethod] / 100).toFixed(2)}`);
    
    return finalCreditAmount; // Retorna o valor que efetivamente foi creditado
    
  } catch (error) {
    console.error("Erro ao processar recuperao de saldo negativo:", error);
    return netAmount; // Em caso de erro, creditar valor total
  }
};

// CALCULAR SALDOS DE COMISSES PARA AFILIADOS
export const calculateAffiliateCommissionsBalance = async (affiliateUid: string): Promise<{
  total: { available: number; processing: number; totalEarned: number };
}> => {
  // Security: User process completed
  
  try {
    // BUSCAR COMISSES DO AFILIADO VIA ENDPOINT DIRETO (SEM NDICES)
    const response = await fetch(`/api/affiliate/commissions/direct/${affiliateUid}`);
    
    if (!response.ok) {
      console.warn("Erro ao buscar comisses, retornando saldo zero");
      return { total: { available: 0, processing: 0, totalEarned: 0 } };
    }
    
    const { commissions = [], stats } = await response.json();
    
    let availableAmount = 0;
    let processingAmount = 0;
    const totalEarned = stats?.totalAmount || 0;
    
    const now = new Date();
    
    // PROCESSAR CADA COMISSÃO
    commissions.forEach((commission: any) => {
      const amount = commission.amount || 0;
      const releaseDate = new Date(commission.releaseDate);
      const isReleased = now >= releaseDate;
      
      console.log(`Comisso ${commission.id}: R$${(amount/100).toFixed(2)} - ${isReleased ? 'DISPONVEL' : 'PROCESSANDO'}`);
      
      if (commission.status === 'available' || (commission.status === 'pending' && isReleased)) {
        availableAmount += amount;
      } else if (commission.status === 'pending') {
        processingAmount += amount;
      }
      // Status 'paid' no soma (já foi pago)
    });
    
    console.log("Saldos calculados:", {
      // Status 'paid' não soma (já foi pago)
      processando: `R$${(processingAmount/100).toFixed(2)}`,
      totalGanho: `R$${(totalEarned/100).toFixed(2)}`
    });
    
    return {
      total: {
        available: availableAmount,
        processing: processingAmount,
        totalEarned: totalEarned
      }
    };
    
  } catch (error) {
    console.error("Erro ao calcular saldo de comisses:", error);
    return { total: { available: 0, processing: 0, totalEarned: 0 } };
  }
};

// ========================================================================================
// SISTEMA DE SUPORTE - CENTRAL DE ATENDIMENTO REAL-TIME
// ========================================================================================

import { 
  SupportTicket, 
  SupportMessage, 
  InsertSupportTicket, 
  InsertSupportMessage,
  generateTicketId,
  generateMessageId
} from "@shared/schema";
import { onSnapshot, writeBatch } from "firebase/firestore";

// HELPER - Remover campos undefined para evitar erro do Firestore
const sanitizeForFirestore = (obj: Record<string, any>): Record<string, any> => {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

// CRIAR NOVO TICKET DE SUPORTE COM MENSAGEM INICIAL - FIREBASE DIRETO
export const createSupportTicket = async (ticketData: InsertSupportTicket): Promise<string> => {
  try {
    console.log("Criando ticket diretamente no Firebase:", ticketData);
    
    const ticketId = `tkt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    // TICKET SEGURO - Apenas campos definidos
    const ticket = sanitizeForFirestore({
      id: ticketId,
      tenantId: ticketData.tenantId,
      sellerId: ticketData.sellerId,
      sellerName: ticketData.sellerName,
      sellerEmail: ticketData.sellerEmail,
      category: ticketData.category,
      subject: ticketData.subject,
      description: ticketData.description,
      status: 'open',
      priority: ticketData.priority || 'normal',
      totalMessages: 1,
      unreadByAdmin: 1,
      unreadBySeller: 0,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    
    // MENSAGEM INICIAL SEGURA 
    const initialMessage = sanitizeForFirestore({
      id: messageId,
      ticketId: ticketId,
      senderId: ticketData.sellerId,
      senderType: "seller",
      senderName: ticketData.sellerName,
      content: ticketData.description,
      messageType: "text",
      isSystemMessage: false,
      readByAdmin: false,
      readBySeller: true,
      createdAt: now,
      updatedAt: now,
    });
    
    console.log('Criando ticket e mensagem inicial:', { ticket, initialMessage });
    
    // OPERAÇÃO ATMICA NO FIREBASE
    const batch = writeBatch(db);
    
    // ADICIONAR TICKET
    const ticketRef = doc(db, "supportTickets", ticketId);
    batch.set(ticketRef, {
      ...ticket,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
    });
    
    // ADICIONAR MENSAGEM INICIAL
    const messageRef = doc(db, "supportMessages", messageId);
    batch.set(messageRef, {
      ...initialMessage,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    // COMMIT ATMICO
    await batch.commit();
    
    console.log('Ticket e mensagem inicial criados atomicamente no Firebase:', ticketId);
    return ticketId;
    
  } catch (error) {
    console.error("ERRO ao criar ticket no Firebase:", error);
    throw new Error(`Falha ao criar ticket de suporte: ${error instanceof Error ? error.message : 'Erro interno'}`);
  }
};

// ADICIONAR MENSAGEM AO TICKET - FIREBASE DIRETO
export const addSupportMessage = async (messageData: InsertSupportMessage): Promise<string> => {
  try {
    console.log("Adicionando mensagem diretamente no Firebase:", messageData);
    
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    // MENSAGEM SEGURA - Apenas campos definidos
    const message = sanitizeForFirestore({
      id: messageId,
      ticketId: messageData.ticketId,
      senderId: messageData.senderId,
      senderType: messageData.senderType,
      senderName: messageData.senderName,
      content: messageData.content,
      messageType: messageData.messageType || 'text',
      isSystemMessage: false,
      readByAdmin: messageData.senderType === 'admin',
      readBySeller: messageData.senderType === 'seller',
      createdAt: now,
      updatedAt: now,
    });
    
    console.log('Criando mensagem:', message);
    
    // OPERAÇÃO ATMICA NO FIREBASE
    const batch = writeBatch(db);
    
    // ADICIONAR MENSAGEM
    const messageRef = doc(db, "supportMessages", messageId);
    batch.set(messageRef, {
      ...message,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    // ATUALIZAR TICKET
    const ticketRef = doc(db, "supportTickets", messageData.ticketId);
    const ticketUpdate: any = {
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    
    // ATUALIZAR CONTADORES BASEADO NO TIPO DE SENDER
    if (messageData.senderType === 'seller') {
      ticketUpdate.unreadByAdmin = 1; // Admin precisa ler
      ticketUpdate.unreadBySeller = 0; // Seller jleu (é quem enviou)
    } else {
      ticketUpdate.unreadByAdmin = 0; // Admin jleu (é quem enviou)
      ticketUpdate.unreadBySeller = 1; // Seller precisa ler
    }
    
    batch.update(ticketRef, ticketUpdate);
    
    // COMMIT ATMICO
    await batch.commit();
    
    console.log('Mensagem adicionada atomicamente no Firebase:', messageId);
    return messageId;
    
  } catch (error) {
    console.error("Erro ao adicionar mensagem no Firebase:", error);
    throw error;
  }
};

//  BUSCAR TICKETS POR TENANT (ADMIN)
export const getSupportTicketsByTenant = async (tenantId?: string): Promise<SupportTicket[]> => {
  try {
    console.log(" Buscando tickets para admin");
    
    let q;
    if (tenantId) {
      q = query(
        collection(db, "supportTickets"),
        where("tenantId", "==", tenantId),
        orderBy("lastMessageAt", "desc")
      );
    } else {
      // Admin master - todos os tickets
      q = query(
        collection(db, "supportTickets"),
        orderBy("lastMessageAt", "desc")
      );
    }
    
    const snapshot = await getDocs(q);
    const tickets = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        lastMessageAt: data.lastMessageAt?.toDate() || new Date(),
        lastAdminReplyAt: data.lastAdminReplyAt?.toDate() || undefined,
        lastSellerReplyAt: data.lastSellerReplyAt?.toDate() || undefined,
        closedAt: data.closedAt?.toDate() || undefined,
        resolvedAt: data.resolvedAt?.toDate() || undefined,
      } as SupportTicket;
    });
    
    console.log(`${tickets.length} tickets encontrados`);
    return tickets;
    
  } catch (error) {
    console.error("Erro ao buscar tickets:", error);
    return [];
  }
};

//  BUSCAR TICKETS POR SELLER
export const getSupportTicketsBySeller = async (sellerId: string): Promise<SupportTicket[]> => {
  try {
    console.log(" Buscando tickets para seller:", sellerId);
    
    const q = query(
      collection(db, "supportTickets"),
      where("sellerId", "==", sellerId),
      orderBy("lastMessageAt", "desc")
    );
    
    const snapshot = await getDocs(q);
    const tickets = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        lastMessageAt: data.lastMessageAt?.toDate() || new Date(),
        lastAdminReplyAt: data.lastAdminReplyAt?.toDate() || undefined,
        lastSellerReplyAt: data.lastSellerReplyAt?.toDate() || undefined,
        closedAt: data.closedAt?.toDate() || undefined,
        resolvedAt: data.resolvedAt?.toDate() || undefined,
      } as SupportTicket;
    });
    
    console.log(`${tickets.length} tickets encontrados para seller`);
    return tickets;
    
  } catch (error) {
    console.error("Erro ao buscar tickets do seller:", error);
    return [];
  }
};

// BUSCAR MENSAGENS DE UM TICKET
export const getSupportMessages = async (ticketId: string): Promise<SupportMessage[]> => {
  try {
    console.log("Buscando mensagens do ticket:", ticketId);
    
    const q = query(
      collection(db, "supportMessages"),
      where("ticketId", "==", ticketId),
      orderBy("createdAt", "asc")
    );
    
    const snapshot = await getDocs(q);
    const messages = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        readAt: data.readAt?.toDate() || undefined,
      } as SupportMessage;
    });
    
    console.log(`${messages.length} mensagens encontradas`);
    return messages;
    
  } catch (error) {
    console.error("Erro ao buscar mensagens:", error);
    return [];
  }
};

// ATUALIZAR STATUS DO TICKET - VIA API BACKEND
export const updateSupportTicketStatus = async (ticketId: string, status: SupportTicket['status'], assignedAdminId?: string, assignedAdminName?: string): Promise<void> => {
  try {
    console.log("Atualizando status via API backend:", { ticketId, status });
    
    const response = await fetch(`/api/support/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status,
        assignedAdminId,
        assignedAdminName,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Erro ao atualizar status');
    }

    console.log("Status atualizado via API backend");
    
  } catch (error) {
    console.error("Erro ao atualizar status via API:", error);
    throw error;
  }
};

// MARCAR MENSAGENS COMO LIDAS - VIA API BACKEND
export const markMessagesAsRead = async (ticketId: string, userType: 'admin' | 'seller'): Promise<void> => {
  try {
    console.log("Marcando mensagens como lidas via API backend:", { ticketId, userType });
    
    const response = await fetch(`/api/support/tickets/${ticketId}/read`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        readerType: userType,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Erro ao marcar mensagens como lidas');
    }

    console.log("Mensagens marcadas como lidas via API backend");
    
  } catch (error) {
    console.error("Erro ao marcar mensagens como lidas via API:", error);
    throw error;
  }
};

// LISTENER REAL-TIME PARA TICKETS (ADMIN)
export const subscribeToTickets = (tenantId: string | undefined, callback: (tickets: SupportTicket[]) => void) => {
  try {
    console.log("Iniciando listener real-time para tickets");
    
    let q;
    if (tenantId) {
      q = query(
        collection(db, "supportTickets"),
        where("tenantId", "==", tenantId),
        orderBy("lastMessageAt", "desc")
      );
    } else {
      q = query(
        collection(db, "supportTickets"),
        orderBy("lastMessageAt", "desc")
      );
    }
    
    return onSnapshot(q, (snapshot) => {
      const tickets = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          lastMessageAt: data.lastMessageAt?.toDate() || new Date(),
          lastAdminReplyAt: data.lastAdminReplyAt?.toDate() || undefined,
          lastSellerReplyAt: data.lastSellerReplyAt?.toDate() || undefined,
          closedAt: data.closedAt?.toDate() || undefined,
          resolvedAt: data.resolvedAt?.toDate() || undefined,
        } as SupportTicket;
      });
      
      console.log(`Tickets atualizados em tempo real: ${tickets.length}`);
      callback(tickets);
    });
    
  } catch (error) {
    console.error("Erro no listener de tickets:", error);
    return () => {};
  }
};

// LISTENER REAL-TIME PARA MENSAGENS
export const subscribeToMessages = (ticketId: string, callback: (messages: SupportMessage[]) => void) => {
  try {
    console.log("Iniciando listener real-time para mensagens do ticket:", ticketId);
    
    const q = query(
      collection(db, "supportMessages"),
      where("ticketId", "==", ticketId),
      orderBy("createdAt", "asc")
    );
    
    return onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          readAt: data.readAt?.toDate() || undefined,
        } as SupportMessage;
      });
      
      console.log(`Mensagens atualizadas em tempo real: ${messages.length}`);
      callback(messages);
    }, (error) => {
      console.error("Erro no listener de mensagens:", error);
      callback([]);
    });
    
  } catch (error) {
    console.error("Erro no listener de mensagens:", error);
    return () => {};
  }
};

// FUNÇES DE LIMPEZA E ADMINISTRAÇÃO

// DELETAR TICKET E SUAS MENSAGENS VIA API BACKEND
export const deleteSupportTicket = async (ticketId: string): Promise<void> => {
  try {
    console.log("Deletando ticket via API backend:", ticketId);
    
    // Obter token de autenticação
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Usuário no autenticado');
    }
    
    const token = await user.getIdToken();
    
    // Chamar API backend para deletar ticket
    const response = await fetch(`/api/support/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || errorData.error || 'Erro ao deletar ticket');
    }
    
    const result = await response.json();
    console.log(`Ticket ${ticketId} deletado permanentemente:`, result);
    
  } catch (error) {
    console.error("Erro ao deletar ticket:", error);
    throw error;
  }
};

// LIMPAR TODOS OS TICKETS DE SUPORTE
export const clearAllSupportTickets = async (): Promise<void> => {
  try {
    console.log("Iniciando limpeza completa de tickets de suporte...");
    
    // Buscar todos os tickets
    const ticketsSnapshot = await getDocs(collection(db, "supportTickets"));
    console.log(` Encontrados ${ticketsSnapshot.size} tickets para deletar`);
    
    // Buscar todas as mensagens
    const messagesSnapshot = await getDocs(collection(db, "supportMessages"));
    console.log(`Encontradas ${messagesSnapshot.size} mensagens para deletar`);
    
    // Criar batch para operao atmica
    const batch = writeBatch(db);
    
    // Deletar todos os tickets
    ticketsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Deletar todas as mensagens
    messagesSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Executar operao atmica
    await batch.commit();
    
    console.log(`Limpeza completa: ${ticketsSnapshot.size} tickets e ${messagesSnapshot.size} mensagens deletados`);
    
  } catch (error) {
    console.error("Erro na limpeza completa:", error);
    throw error;
  }
};

// ESTATSTICAS DOS TICKETS
export const getSupportStats = async (tenantId?: string): Promise<{
  total: number;
  open: number;
  answered: number;
  closed: number;
  resolved: number;
}> => {
  try {
    let q;
    if (tenantId) {
      q = query(
        collection(db, "supportTickets"),
        where("tenantId", "==", tenantId)
      );
    } else {
      q = query(collection(db, "supportTickets"));
    }
    
    const snapshot = await getDocs(q);
    const tickets = snapshot.docs.map(doc => doc.data() as SupportTicket);
    
    const stats = {
      total: tickets.length,
      open: tickets.filter(t => t.status === 'open').length,
      answered: tickets.filter(t => t.status === 'answered').length,
      closed: tickets.filter(t => t.status === 'closed').length,
      resolved: tickets.filter(t => t.status === 'resolved').length,
    };
    
    console.log("Estatsticas de suporte:", stats);
    return stats;
    
  } catch (error) {
    console.error("Erro ao buscar estatsticas:", error);
    return { total: 0, open: 0, answered: 0, closed: 0, resolved: 0 };
  }
};

// FUNÇÃO DESABILITADA - área deb membros agora é criada VAZIA
// Seller cria primeiro mdulo e aula manualmente
export async function setupMembersAreaForAllProducts() {
  console.log('FUNÇÃO DESABILITADA - reas de membros devem ser criadas VAZIAS');
  console.log('Seller deve criar primeiro mdulo e aula manualmente');
  
  return {
    success: true,
    message: 'Funo desabilitada - reas de membros criadas vazias',
    processed: 0,
    created: 0,
    errors: []
  };
}
