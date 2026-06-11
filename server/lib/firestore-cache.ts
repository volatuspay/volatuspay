import { getFirestore, getRTDB } from './firebase-admin.js';
import { serviceBreakers } from './circuit-breaker.js';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class FirestoreCache {
  private checkouts = new Map<string, CacheEntry<any>>();
  private products = new Map<string, CacheEntry<any>>();
  private sellers = new Map<string, CacheEntry<any>>();
  private banners = new Map<string, CacheEntry<any[]>>();
  private tenantCheckouts = new Map<string, CacheEntry<any[]>>();
  private paymentConfig = new Map<string, CacheEntry<any>>();
  private affiliates = new Map<string, CacheEntry<any>>();
  private users = new Map<string, CacheEntry<any>>();
  private tenantSettings = new Map<string, CacheEntry<any>>();
  private apiKeys = new Map<string, CacheEntry<any>>();
  private showcaseResponse = new Map<string, CacheEntry<any>>();
  private globalFeeConfig = new Map<string, CacheEntry<any>>();
  private pixels = new Map<string, CacheEntry<any[]>>();
  
  private CHECKOUT_TTL = 15 * 60 * 1000;
  private PRODUCT_TTL = 15 * 60 * 1000;
  private SELLER_TTL = 10 * 60 * 1000;
  private BANNER_TTL = 15 * 60 * 1000;
  private TENANT_CHECKOUTS_TTL = 10 * 60 * 1000;
  private PAYMENT_CONFIG_TTL = 30 * 60 * 1000;
  private AFFILIATE_TTL = 10 * 60 * 1000;
  private USER_TTL = 10 * 60 * 1000;
  private TENANT_SETTINGS_TTL = 10 * 60 * 1000;
  private API_KEY_TTL = 10 * 60 * 1000;
  private SHOWCASE_TTL = 5 * 60 * 1000;
  private GLOBAL_FEE_TTL = 30 * 60 * 1000;
  private PIXELS_TTL = 15 * 60 * 1000;
  
  private MAX_ENTRIES = 5000;
  
  private stats = {
    hits: 0,
    misses: 0,
    firestoreErrors: 0,
    circuitBreakerTrips: 0
  };

  private async firestoreCall<T>(fn: () => Promise<T>, staleData?: T): Promise<T> {
    return serviceBreakers.firestore.execute(
      () => withFirestoreTimeout(fn(), 8000),
      staleData !== undefined ? () => {
        this.stats.circuitBreakerTrips++;
        console.warn('⚡ [CACHE] Firestore circuit breaker OPEN, serving stale data');
        return staleData;
      } : undefined
    );
  }

  private isExpired<T>(entry: CacheEntry<T> | undefined): boolean {
    if (!entry) return true;
    return Date.now() > entry.expiresAt;
  }

  private evictIfNeeded(map: Map<string, any>): void {
    if (map.size > this.MAX_ENTRIES) {
      const keysToDelete = Array.from(map.keys()).slice(0, Math.floor(this.MAX_ENTRIES * 0.2));
      keysToDelete.forEach(k => map.delete(k));
    }
  }

  async getCheckout(checkoutId: string): Promise<any | null> {
    const cached = this.checkouts.get(checkoutId);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }

    this.stats.misses++;
    try {
      const data = await this.firestoreCall(async () => {
        const db = getFirestore();
        const doc = await db.collection('checkouts').doc(checkoutId).get();
        if (doc.exists) {
          return { id: doc.id, ...doc.data() };
        }
        return null;
      }, cached?.data ?? undefined);

      this.checkouts.set(checkoutId, {
        data,
        expiresAt: Date.now() + this.CHECKOUT_TTL
      });
      this.evictIfNeeded(this.checkouts);
      return data;
    } catch (error: any) {
      this.stats.firestoreErrors++;
      if (cached?.data) {
        console.warn(`⚠️ [CACHE] Firestore error for checkout ${checkoutId}, serving stale cache`);
        return cached.data;
      }
      return null;
    }
  }

  async getCheckoutsBatch(checkoutIds: string[]): Promise<Map<string, any>> {
    const result = new Map<string, any>();
    const toFetch: string[] = [];

    for (const id of checkoutIds) {
      const cached = this.checkouts.get(id);
      if (!this.isExpired(cached)) {
        this.stats.hits++;
        if (cached!.data) result.set(id, cached!.data);
      } else {
        toFetch.push(id);
      }
    }

    if (toFetch.length > 0) {
      this.stats.misses += toFetch.length;
      try {
        const db = getFirestore();
        const docs = await Promise.all(
          toFetch.map(id => db.collection('checkouts').doc(id).get())
        );
        docs.forEach(doc => {
          if (doc.exists) {
            const data = { id: doc.id, ...doc.data() };
            result.set(doc.id, data);
            this.checkouts.set(doc.id, {
              data,
              expiresAt: Date.now() + this.CHECKOUT_TTL
            });
          } else {
            this.checkouts.set(doc.id, {
              data: null,
              expiresAt: Date.now() + this.CHECKOUT_TTL
            });
          }
        });
        this.evictIfNeeded(this.checkouts);
      } catch (error: any) {
        this.stats.firestoreErrors++;
        console.warn(`⚠️ [CACHE] Firestore batch error for checkouts, serving stale:`, error.message);
        for (const id of toFetch) {
          const stale = this.checkouts.get(id);
          if (stale?.data) result.set(id, stale.data);
        }
      }
    }

    return result;
  }

  async getProduct(productId: string): Promise<any | null> {
    const cached = this.products.get(productId);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }

    this.stats.misses++;
    try {
      const data = await this.firestoreCall(async () => {
        const db = getFirestore();
        const doc = await db.collection('products').doc(productId).get();
        if (doc.exists) {
          return { id: doc.id, ...doc.data() };
        }
        return null;
      }, cached?.data ?? undefined);

      this.products.set(productId, {
        data,
        expiresAt: Date.now() + this.PRODUCT_TTL
      });
      this.evictIfNeeded(this.products);
      return data;
    } catch (error: any) {
      this.stats.firestoreErrors++;
      if (cached?.data) {
        console.warn(`⚠️ [CACHE] Firestore error for product ${productId}, serving stale cache`);
        return cached.data;
      }
      return null;
    }
  }

  async getProductsBatch(productIds: string[]): Promise<Map<string, any>> {
    const result = new Map<string, any>();
    const toFetch: string[] = [];

    for (const id of productIds) {
      const cached = this.products.get(id);
      if (!this.isExpired(cached)) {
        this.stats.hits++;
        if (cached!.data) result.set(id, cached!.data);
      } else {
        toFetch.push(id);
      }
    }

    if (toFetch.length > 0) {
      this.stats.misses += toFetch.length;
      try {
        const db = getFirestore();
        const docs = await Promise.all(
          toFetch.map(id => db.collection('products').doc(id).get())
        );
        docs.forEach(doc => {
          if (doc.exists) {
            const data = { id: doc.id, ...doc.data() };
            result.set(doc.id, data);
            this.products.set(doc.id, {
              data,
              expiresAt: Date.now() + this.PRODUCT_TTL
            });
          } else {
            this.products.set(doc.id, {
              data: null,
              expiresAt: Date.now() + this.PRODUCT_TTL
            });
          }
        });
        this.evictIfNeeded(this.products);
      } catch (error: any) {
        this.stats.firestoreErrors++;
        console.warn(`⚠️ [CACHE] Firestore batch error for products, serving stale:`, error.message);
        for (const id of toFetch) {
          const stale = this.products.get(id);
          if (stale?.data) result.set(id, stale.data);
        }
      }
    }

    return result;
  }

  async getSeller(sellerId: string): Promise<any | null> {
    const cached = this.sellers.get(sellerId);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }

    this.stats.misses++;
    try {
      const data = await this.firestoreCall(async () => {
        const db = getFirestore();
        const doc = await db.collection('sellers').doc(sellerId).get();
        if (doc.exists) {
          return { id: doc.id, ...doc.data() };
        }
        return null;
      }, cached?.data ?? undefined);

      this.sellers.set(sellerId, {
        data,
        expiresAt: Date.now() + this.SELLER_TTL
      });
      this.evictIfNeeded(this.sellers);
      return data;
    } catch (error: any) {
      this.stats.firestoreErrors++;
      if (cached?.data) {
        console.warn(`⚠️ [CACHE] Firestore error for seller ${sellerId}, serving stale cache`);
        return cached.data;
      }
      return null;
    }
  }

  getBannersFromCache(cacheKey: string): any[] | undefined {
    const cached = this.banners.get(cacheKey);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }
    this.stats.misses++;
    return undefined;
  }

  setBannersCache(cacheKey: string, data: any[]): void {
    this.banners.set(cacheKey, {
      data,
      expiresAt: Date.now() + this.BANNER_TTL
    });
  }

  getTenantCheckoutsFromCache(tenantId: string): any[] | undefined {
    const cached = this.tenantCheckouts.get(tenantId);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }
    this.stats.misses++;
    return undefined;
  }

  setTenantCheckoutsCache(tenantId: string, data: any[]): void {
    this.tenantCheckouts.set(tenantId, {
      data,
      expiresAt: Date.now() + this.TENANT_CHECKOUTS_TTL
    });
  }

  invalidateTenantCheckouts(tenantId: string): void {
    this.tenantCheckouts.delete(tenantId);
  }

  getPaymentConfigFromCache(key: string = 'global'): any | undefined {
    const cached = this.paymentConfig.get(key);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }
    this.stats.misses++;
    return undefined;
  }

  setPaymentConfigCache(key: string, data: any): void {
    this.paymentConfig.set(key, {
      data,
      expiresAt: Date.now() + this.PAYMENT_CONFIG_TTL
    });
  }

  invalidatePaymentConfig(key?: string): void {
    if (key) {
      this.paymentConfig.delete(key);
    } else {
      this.paymentConfig.clear();
    }
  }

  async getAffiliate(affiliateId: string): Promise<any | null> {
    const cached = this.affiliates.get(affiliateId);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }

    this.stats.misses++;
    try {
      const data = await this.firestoreCall(async () => {
        const db = getFirestore();
        const doc = await db.collection('affiliates').doc(affiliateId).get();
        if (doc.exists) {
          return { id: doc.id, ...doc.data() };
        }
        return null;
      }, cached?.data ?? undefined);

      this.affiliates.set(affiliateId, {
        data,
        expiresAt: Date.now() + this.AFFILIATE_TTL
      });
      this.evictIfNeeded(this.affiliates);
      return data;
    } catch (error: any) {
      this.stats.firestoreErrors++;
      if (cached?.data) {
        console.warn(`⚠️ [CACHE] Firestore error for affiliate ${affiliateId}, serving stale cache`);
        return cached.data;
      }
      return null;
    }
  }

  getAffiliateByCode(code: string): any | undefined {
    const cacheKey = `code_${code}`;
    const cached = this.affiliates.get(cacheKey);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }
    this.stats.misses++;
    return undefined;
  }

  setAffiliateByCode(code: string, data: any): void {
    const cacheKey = `code_${code}`;
    this.affiliates.set(cacheKey, {
      data,
      expiresAt: Date.now() + this.AFFILIATE_TTL
    });
    this.evictIfNeeded(this.affiliates);
  }

  setCheckout(checkoutId: string, data: any): void {
    this.checkouts.set(checkoutId, {
      data: data ? { id: checkoutId, ...data } : null,
      expiresAt: Date.now() + this.CHECKOUT_TTL
    });
  }

  setProduct(productId: string, data: any): void {
    this.products.set(productId, {
      data: data ? { id: productId, ...data } : null,
      expiresAt: Date.now() + this.PRODUCT_TTL
    });
  }

  setSeller(sellerId: string, data: any): void {
    this.sellers.set(sellerId, {
      data: data ? { id: sellerId, ...data } : null,
      expiresAt: Date.now() + this.SELLER_TTL
    });
  }

  invalidateCheckout(checkoutId: string): void {
    this.checkouts.delete(checkoutId);
  }

  invalidateProduct(productId: string): void {
    this.products.delete(productId);
  }

  invalidateSeller(sellerId: string): void {
    this.sellers.delete(sellerId);
  }

  invalidateBanners(position?: string): void {
    if (position) {
      this.banners.delete(position);
    } else {
      this.banners.clear();
    }
  }

  async getUser(userId: string): Promise<any | null> {
    const cached = this.users.get(userId);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }

    this.stats.misses++;
    try {
      const data = await this.firestoreCall(async () => {
        const db = getFirestore();
        const doc = await db.collection('users').doc(userId).get();
        if (doc.exists) {
          return { id: doc.id, ...doc.data() };
        }
        return null;
      }, cached?.data ?? undefined);

      this.users.set(userId, {
        data,
        expiresAt: Date.now() + this.USER_TTL
      });
      this.evictIfNeeded(this.users);
      return data;
    } catch (error: any) {
      this.stats.firestoreErrors++;
      if (cached?.data) {
        console.warn(`⚠️ [CACHE] Firestore error for user ${userId}, serving stale cache`);
        return cached.data;
      }
      return null;
    }
  }

  async getTenantSettings(tenantId: string): Promise<any | null> {
    const cached = this.tenantSettings.get(tenantId);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }

    this.stats.misses++;
    try {
      const data = await this.firestoreCall(async () => {
        const db = getFirestore();
        const doc = await db.collection('tenantSettings').doc(tenantId).get();
        if (doc.exists) {
          return { id: doc.id, ...doc.data() };
        }
        return null;
      }, cached?.data ?? undefined);

      this.tenantSettings.set(tenantId, {
        data,
        expiresAt: Date.now() + this.TENANT_SETTINGS_TTL
      });
      this.evictIfNeeded(this.tenantSettings);
      return data;
    } catch (error: any) {
      this.stats.firestoreErrors++;
      if (cached?.data) return cached.data;
      return null;
    }
  }

  getApiKeyFromCache(keyHash: string): any | undefined {
    const cached = this.apiKeys.get(keyHash);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }
    this.stats.misses++;
    return undefined;
  }

  setApiKeyCache(keyHash: string, data: any): void {
    this.apiKeys.set(keyHash, {
      data,
      expiresAt: Date.now() + this.API_KEY_TTL
    });
    this.evictIfNeeded(this.apiKeys);
  }

  invalidateApiKey(keyHash: string): void {
    this.apiKeys.delete(keyHash);
  }

  getShowcaseFromCache(cacheKey: string = 'all'): any | undefined {
    const cached = this.showcaseResponse.get(cacheKey);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }
    this.stats.misses++;
    return undefined;
  }

  setShowcaseCache(cacheKey: string, data: any): void {
    this.showcaseResponse.set(cacheKey, {
      data,
      expiresAt: Date.now() + this.SHOWCASE_TTL
    });
  }

  invalidateShowcase(): void {
    this.showcaseResponse.clear();
  }

  getGlobalFeeConfigFromCache(key: string = 'global'): any | undefined {
    const cached = this.globalFeeConfig.get(key);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }
    this.stats.misses++;
    return undefined;
  }

  setGlobalFeeConfigCache(key: string, data: any): void {
    this.globalFeeConfig.set(key, {
      data,
      expiresAt: Date.now() + this.GLOBAL_FEE_TTL
    });
  }

  invalidateGlobalFeeConfig(): void {
    this.globalFeeConfig.clear();
  }

  getPixelsFromCache(parentId: string): any[] | undefined {
    const cached = this.pixels.get(parentId);
    if (!this.isExpired(cached)) {
      this.stats.hits++;
      return cached!.data;
    }
    this.stats.misses++;
    return undefined;
  }

  setPixelsCache(parentId: string, data: any[]): void {
    this.pixels.set(parentId, {
      data,
      expiresAt: Date.now() + this.PIXELS_TTL
    });
  }

  invalidatePixels(parentId?: string): void {
    if (parentId) {
      this.pixels.delete(parentId);
    } else {
      this.pixels.clear();
    }
  }

  setUser(userId: string, data: any): void {
    this.users.set(userId, {
      data: data ? { id: userId, ...data } : null,
      expiresAt: Date.now() + this.USER_TTL
    });
  }

  invalidateUser(userId: string): void {
    this.users.delete(userId);
  }

  invalidateTenantSettings(tenantId: string): void {
    this.tenantSettings.delete(tenantId);
  }

  async warmUp(): Promise<{ sellers: number; paymentConfig: boolean; globalFee: boolean; duration: number }> {
    const start = Date.now();
    let sellersLoaded = 0;
    let paymentConfigLoaded = false;
    let globalFeeLoaded = false;

    try {
      const db = getFirestore();

      const [sellersSnap, paymentConfigDoc, globalFeeDoc] = await Promise.all([
        db.collection('sellers')
          .where('status', '==', 'approved')
          .limit(200)
          .get(),
        db.collection('config').doc('paymentConfig').get(),
        db.collection('config').doc('globalFees').get()
      ]);

      for (const doc of sellersSnap.docs) {
        const data = { id: doc.id, ...doc.data() };
        this.sellers.set(doc.id, {
          data,
          expiresAt: Date.now() + this.SELLER_TTL
        });
        sellersLoaded++;
      }

      if (paymentConfigDoc.exists) {
        const data = paymentConfigDoc.data();
        this.paymentConfig.set('global', {
          data,
          expiresAt: Date.now() + this.PAYMENT_CONFIG_TTL
        });
        paymentConfigLoaded = true;
      }

      if (globalFeeDoc.exists) {
        const data = globalFeeDoc.data();
        this.globalFeeConfig.set('global', {
          data,
          expiresAt: Date.now() + this.GLOBAL_FEE_TTL
        });
        globalFeeLoaded = true;
      }

      if (sellersLoaded > 0) {
        this.backupSellersToRTDB().catch(() => {});
      }

      const duration = Date.now() - start;
      console.log(`🔥 [CACHE WARM-UP] Concluído em ${duration}ms: ${sellersLoaded} sellers, paymentConfig=${paymentConfigLoaded}, globalFee=${globalFeeLoaded}`);
      return { sellers: sellersLoaded, paymentConfig: paymentConfigLoaded, globalFee: globalFeeLoaded, duration };
    } catch (error: any) {
      const duration = Date.now() - start;
      console.error(`⚠️ [CACHE WARM-UP] Firestore falhou (${duration}ms):`, error.message);

      try {
        const loaded = await this.loadSellersFromRTDB();
        sellersLoaded = loaded;
        if (loaded > 0) {
          console.log(`✅ [CACHE WARM-UP] RTDB fallback: ${loaded} sellers carregados`);
        }
      } catch (rtdbErr: any) {
        console.error(`⚠️ [CACHE WARM-UP] RTDB fallback também falhou:`, rtdbErr.message);
      }

      return { sellers: sellersLoaded, paymentConfig: paymentConfigLoaded, globalFee: globalFeeLoaded, duration: Date.now() - start };
    }
  }

  private async backupSellersToRTDB(): Promise<void> {
    try {
      const rtdb = getRTDB();
      const sellersBackup: Record<string, any> = {};
      for (const [id, entry] of this.sellers.entries()) {
        if (entry.data) {
          sellersBackup[id] = {
            id: entry.data.id || id,
            email: entry.data.email || '',
            name: entry.data.name || entry.data.businessName || '',
            status: entry.data.status || 'approved',
            tenantId: entry.data.tenantId || id,
          };
        }
      }
      await rtdb.ref('tetri-system/sellers-backup').set({
        ...sellersBackup,
        _lastSync: new Date().toISOString(),
        _count: Object.keys(sellersBackup).length
      });
      console.log(`✅ [CACHE] ${Object.keys(sellersBackup).length} sellers salvos no RTDB como backup`);
    } catch (err: any) {
      console.warn('⚠️ [CACHE] Erro ao salvar sellers no RTDB:', err.message);
    }
  }

  private async loadSellersFromRTDB(): Promise<number> {
    const rtdb = getRTDB();
    const snap = await rtdb.ref('tetri-system/sellers-backup').once('value');
    if (!snap.exists()) return 0;

    const data = snap.val();
    let count = 0;
    for (const [id, seller] of Object.entries(data)) {
      if (id.startsWith('_')) continue;
      const sellerData = seller as any;
      this.sellers.set(id, {
        data: { id, ...sellerData },
        expiresAt: Date.now() + this.SELLER_TTL * 2
      });
      count++;
    }
    return count;
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const firestoreBreakerStats = serviceBreakers.firestore.getStats();
    return {
      ...this.stats,
      hitRate: total > 0 ? `${((this.stats.hits / total) * 100).toFixed(1)}%` : '0%',
      firestoreCircuitBreaker: {
        state: firestoreBreakerStats.state,
        totalCalls: firestoreBreakerStats.totalCalls,
        totalFailures: firestoreBreakerStats.totalFailures,
        shortCircuited: firestoreBreakerStats.totalShortCircuited
      },
      sizes: {
        checkouts: this.checkouts.size,
        products: this.products.size,
        sellers: this.sellers.size,
        banners: this.banners.size,
        tenantCheckouts: this.tenantCheckouts.size,
        paymentConfig: this.paymentConfig.size,
        affiliates: this.affiliates.size,
        users: this.users.size,
        tenantSettings: this.tenantSettings.size,
        apiKeys: this.apiKeys.size,
        showcase: this.showcaseResponse.size,
        globalFeeConfig: this.globalFeeConfig.size,
        pixels: this.pixels.size
      }
    };
  }
}

export function withFirestoreTimeout<T>(promise: Promise<T>, ms: number = 5000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), ms))
  ]);
}

export const firestoreCache = new FirestoreCache();
