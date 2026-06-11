import { InsertCheckoutEvent } from '@shared/schema';

export type AnalyticsEventType = 
  | 'checkout_pageview' 
  | 'checkout_initiated' 
  | 'purchase_button_click' 
  | 'purchase_approved' 
  | 'purchase_pending'
  | 'checkout_heartbeat'  // Heartbeat de sessão ativa
  | 'checkout_exit';       // Saída do checkout

interface AnalyticsConfig {
  checkoutId: string;
  offerId?: string;
  productId?: string;
  tenantId: string;
}

class CheckoutAnalyticsTracker {
  private config: AnalyticsConfig | null = null;
  private sessionId: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private exitHandler: (() => void) | null = null;

  initialize(config: AnalyticsConfig) {
    if (this.isInitialized) {
      console.warn('[CheckoutAnalytics] Already initialized');
      return;
    }

    this.config = config;
    this.sessionId = this.getOrCreateSessionId();
    this.isInitialized = true;

    this.startHeartbeat();

    console.log('[CheckoutAnalytics] Initialized:', { 
      checkoutId: config.checkoutId, 
      sessionId: this.sessionId 
    });
  }

  private getOrCreateSessionId(): string {
    const storageKey = 'volatuspay_analytics_session';
    let sessionId = sessionStorage.getItem(storageKey);
    
    if (!sessionId) {
      sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem(storageKey, sessionId);
    }
    
    return sessionId;
  }

  async track(eventType: AnalyticsEventType, metadata?: Record<string, any>, useBeacon = false) {
    if (!this.config || !this.sessionId) {
      console.error('[CheckoutAnalytics] Not initialized');
      return;
    }

    const event: Partial<InsertCheckoutEvent> = {
      checkoutId: this.config.checkoutId,
      offerId: this.config.offerId,
      productId: this.config.productId,
      tenantId: this.config.tenantId,
      eventType,
      sessionId: this.sessionId,
      userAgent: navigator.userAgent,
      referrer: document.referrer || undefined,
      metadata,
      occurredAt: new Date(),
    };

    try {
      // 🚪 Para eventos de saída, usar sendBeacon (mais confiável em beforeunload)
      if (useBeacon && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(event)], { type: 'application/json' });
        const sent = navigator.sendBeacon('/api/checkout-events', blob);
        if (sent) {
          console.log('[CheckoutAnalytics] Event sent via beacon:', eventType);
          return; // ✅ RETURN para evitar duplicatas - não executar fetch
        } else {
          console.warn('[CheckoutAnalytics] Beacon failed, using fetch fallback');
        }
      }
      
      // Fallback: fetch com keepalive para eventos críticos
      const response = await fetch('/api/checkout-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
        keepalive: eventType === 'checkout_exit', // Garantir entrega de eventos de saída
      });

      if (!response.ok) {
        console.error('[CheckoutAnalytics] Failed to track:', eventType, response.status);
      } else {
        console.log('[CheckoutAnalytics] Event tracked:', eventType);
      }
    } catch (error) {
      console.error('[CheckoutAnalytics] Error tracking event:', error);
    }
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // 💓 Enviar heartbeat a cada 30 segundos
    this.heartbeatInterval = setInterval(() => {
      this.track('checkout_heartbeat', { timestamp: Date.now() });
    }, 30000);
    
    // 🚪 Detectar saída da página (beacon para confiabilidade)
    this.exitHandler = () => {
      this.track('checkout_exit', { timestamp: Date.now() }, true); // useBeacon = true
    };
    window.addEventListener('beforeunload', this.exitHandler);
    
    // 🔄 Detectar mudanças de rota SPA (se aplicável)
    window.addEventListener('popstate', this.exitHandler);
  }

  // 🚪 MÉTODO PÚBLICO: Terminar sessão explicitamente (SPA navigation)
  terminate(reason = 'navigation') {
    if (!this.isInitialized) return;
    
    console.log('[CheckoutAnalytics] Terminating session:', reason);
    this.track('checkout_exit', { reason }, true); // useBeacon = true
    this.cleanup();
  }

  private cleanup() {
    // Remover listeners
    if (this.exitHandler) {
      window.removeEventListener('beforeunload', this.exitHandler);
      window.removeEventListener('popstate', this.exitHandler);
      this.exitHandler = null;
    }
    
    // Parar heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    this.isInitialized = false;
  }

  destroy() {
    // Enviar evento de saída antes de destruir (com beacon)
    this.terminate('destroy');
    console.log('[CheckoutAnalytics] Destroyed');
  }
}

export const checkoutAnalyticsTracker = new CheckoutAnalyticsTracker();
