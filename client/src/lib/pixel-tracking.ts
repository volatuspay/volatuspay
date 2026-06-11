// ✅ SISTEMA COMPLETO DE PIXEL TRACKING - 100% CÓDIGOS OFICIAIS
// Plataformas Suportadas: TikTok, Facebook, Google Ads, Google Analytics 4, Pinterest, Kwai
// Todos os eventos são REAIS e disparados automaticamente
// ✅ Facebook Pixel: Código oficial Meta (apenas Pixel ID)
// ✅ TikTok Pixel: Código oficial TikTok (apenas Pixel ID)
// ✅ Google Ads: Código oficial Google (ID + Conversion Label)
// ✅ Google Analytics 4: Código oficial GA4 (Measurement ID G-XXXXXXXXXX)
// ✅ Pinterest Pixel: Código oficial Pinterest (Tag ID)
// ✅ Kwai Pixel: Código oficial Kwai Ads 2024 (Pixel ID)

// ✅ MANAGED PIXEL - Estrutura da API (camelCase para consistência com schema Zod)
interface ManagedPixel {
  id: string;
  platform: 'google_ads' | 'google_analytics_4' | 'facebook' | 'tiktok' | 'kwai' | 'pinterest';
  name: string;
  enabled: boolean;
  events: {
    pageView?: boolean;
    viewContent?: boolean;
    addToCart?: boolean;
    initiateCheckout?: boolean;
    addPaymentInfo?: boolean;
    purchase?: boolean;
  };
  // Campos específicos por plataforma
  pixelId?: string;          // Facebook, TikTok, Kwai, Pinterest
  conversionId?: string;      // Google Ads
  conversionLabel?: string;   // Google Ads
  measurementId?: string;     // Google Analytics 4
  tagId?: string;            // Pinterest
  accessToken?: string;      // TikTok (opcional)
}

interface PixelConfig {
  tiktokPixel?: string;
  facebookPixel?: string;
  googleAdsId?: string;
  googleAdsLabel?: string;
  googleAnalytics4Id?: string; // GA4 Measurement ID (G-XXXXXXXXXX)
  pinterestPixel?: string;
  kawaiPixel?: string;
}

interface PurchaseData {
  value: number;
  currency: string;
  transactionId: string;
  productName: string;
  productId?: string;
}

// SINGLETON PARA GARANTIR QUE SCRIPTS SSEJAM CARREGADOS UMA VEZ
class PixelTracker {
  private static instance: PixelTracker;
  private loadedPixels = new Set<string>();
  private config: PixelConfig = {};
  private managedPixels: ManagedPixel[] = [];
  private initializedCheckoutId: string | null = null;
  private firedEvents = new Set<string>();

  private constructor() {}

  public static getInstance(): PixelTracker {
    if (!PixelTracker.instance) {
      PixelTracker.instance = new PixelTracker();
    }
    return PixelTracker.instance;
  }

  public initializeFromManagedPixels(pixels: ManagedPixel[]) {
    const pixelSignature = pixels.map(p => `${p.platform}:${p.pixelId || p.conversionId || p.measurementId || p.tagId}`).sort().join('|');
    
    if (this.initializedCheckoutId === pixelSignature && this.managedPixels.length > 0) {
      console.log('[PIXEL] Pixels ja inicializados com mesma config - pulando reinit');
      return;
    }

    console.log('[PIXEL] Inicializando Managed Pixels:', pixels.length);
    
    const seen = new Set<string>();
    const dedupedPixels = pixels.filter(p => {
      const key = `${p.platform}:${p.pixelId || p.conversionId || p.measurementId || p.tagId}`;
      if (seen.has(key)) {
        console.log(`[PIXEL] Removendo pixel duplicado: ${key}`);
        return false;
      }
      seen.add(key);
      return true;
    });
    console.log(`[PIXEL] Pixels apos dedup: ${dedupedPixels.length} (de ${pixels.length})`);
    
    this.config = {};
    this.managedPixels = dedupedPixels;
    this.initializedCheckoutId = pixelSignature;
    this.firedEvents.clear();
    
    dedupedPixels.forEach(pixel => {
      if (!pixel.enabled) {
        console.log(`⏭️ Pixel ${pixel.platform} desabilitado - pulando`);
        return;
      }
      
      console.log(`✅ Carregando pixel ${pixel.platform}:`, pixel.name);
      
      switch (pixel.platform) {
        case 'facebook':
          if (pixel.pixelId) {
            this.config.facebookPixel = pixel.pixelId; // ✅ CRITICAL: Atualiza config
            this.loadFacebookPixel(pixel.pixelId);
          }
          break;
        case 'tiktok':
          if (pixel.pixelId) {
            this.config.tiktokPixel = pixel.pixelId; // ✅ CRITICAL: Atualiza config
            this.loadTikTokPixel(pixel.pixelId);
          }
          break;
        case 'google_ads':
          if (pixel.conversionId) {
            this.config.googleAdsId = pixel.conversionId; // ✅ CRITICAL: Atualiza config
            this.config.googleAdsLabel = pixel.conversionLabel; // ✅ Armazena label para conversão
            this.loadGoogleAds(pixel.conversionId);
          }
          break;
        case 'google_analytics_4':
          if (pixel.measurementId) {
            this.config.googleAnalytics4Id = pixel.measurementId; // ✅ CRITICAL: Atualiza config
            this.loadGoogleAnalytics4(pixel.measurementId);
          }
          break;
        case 'pinterest':
          if (pixel.tagId || pixel.pixelId) {
            const pinterestId = pixel.tagId || pixel.pixelId!;
            this.config.pinterestPixel = pinterestId; // ✅ CRITICAL: Atualiza config
            this.loadPinterestPixel(pinterestId);
          }
          break;
        case 'kwai':
          if (pixel.pixelId) {
            this.config.kawaiPixel = pixel.pixelId; // ✅ CRITICAL: Atualiza config
            this.loadKawaiPixel(pixel.pixelId);
          }
          break;
      }
    });
    
    console.log('✅ Config atualizado:', this.config);
  }

  public initialize(config: PixelConfig) {
    const legacySig = JSON.stringify(config);
    if (this.initializedCheckoutId === legacySig) {
      console.log('[PIXEL] Legacy pixels ja inicializados com mesma config - pulando reinit');
      return;
    }
    
    console.log('[PIXEL] Inicializando pixels legacy (backward compatibility)');
    this.config = config;
    this.managedPixels = [];
    this.initializedCheckoutId = legacySig;
    this.firedEvents.clear();

    if (config.tiktokPixel) this.loadTikTokPixel(config.tiktokPixel);
    if (config.facebookPixel) this.loadFacebookPixel(config.facebookPixel);
    if (config.googleAdsId) this.loadGoogleAds(config.googleAdsId);
    if (config.googleAnalytics4Id) this.loadGoogleAnalytics4(config.googleAnalytics4Id);
    if (config.pinterestPixel) this.loadPinterestPixel(config.pinterestPixel);
    if (config.kawaiPixel) this.loadKawaiPixel(config.kawaiPixel);
  }

  // TIKTOK PIXEL
  private loadTikTokPixel(pixelId: string) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.loadedPixels.has('tiktok')) return;
    
    
    // Script oficial do TikTok
    const script = document.createElement('script');
    script.innerHTML = `
      !function (w, d, t) {
        w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
        ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],
        ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
        for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
        ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},
        ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";
        ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};
        var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;
        var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
        ttq.load('${pixelId}');
      }(window, document, 'ttq');
    `;
    document.head.appendChild(script);
    this.loadedPixels.add('tiktok');
  }

  // FACEBOOK PIXEL
  private loadFacebookPixel(pixelId: string) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.loadedPixels.has('facebook')) return;
    
    console.log(`[PIXEL] Facebook: Injetando base code para pixel ID: ${pixelId}`);
    
    // Script oficial do Facebook (init apenas - PageView disparado via trackPageView)
    const script = document.createElement('script');
    script.innerHTML = `
      !function(f,b,e,v,n,t,s)
      {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)}(window, document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${pixelId}');
      console.log('[PIXEL] Facebook fbq init para: ${pixelId}');
    `;
    document.head.appendChild(script);
    
    this.loadedPixels.add('facebook');
    console.log(`[PIXEL] Facebook: Script injetado com sucesso, fbq disponivel: ${!!(window as any).fbq}`);
  }

  // GOOGLE ADS (GTAG)
  private loadGoogleAds(adsId: string) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.loadedPixels.has('google-ads')) return;
    
    
    // Script oficial do Google
    const script1 = document.createElement('script');
    script1.async = true;
    script1.src = `https://www.googletagmanager.com/gtag/js?id=${adsId}`;
    document.head.appendChild(script1);
    
    const script2 = document.createElement('script');
    script2.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${adsId}', { send_page_view: false });
    `;
    document.head.appendChild(script2);
    
    this.loadedPixels.add('google-ads');
  }

  // GOOGLE ANALYTICS 4 (GA4)
  private loadGoogleAnalytics4(measurementId: string) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.loadedPixels.has('ga4')) return;
    
    
    // Script oficial do GA4
    const script1 = document.createElement('script');
    script1.async = true;
    script1.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script1);
    
    const script2 = document.createElement('script');
    script2.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${measurementId}', {
        send_page_view: false
      });
    `;
    document.head.appendChild(script2);
    
    this.loadedPixels.add('ga4');
  }

  // PINTEREST PIXEL
  private loadPinterestPixel(pixelId: string) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.loadedPixels.has('pinterest')) return;
    
    
    // Script oficial do Pinterest
    const script = document.createElement('script');
    script.innerHTML = `
      !function(e){if(!window.pintrk){window.pintrk = function () {
      window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var
      n=window.pintrk;n.queue=[],n.version="3.0";var
      t=document.createElement("script");t.async=!0,t.src=e;var
      r=document.getElementsByTagName("script")[0];
      r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");
      pintrk('load', '${pixelId}', {em: ''});
    `;
    document.head.appendChild(script);
    
    // Noscript fallback
    const noscript = document.createElement('noscript');
    noscript.innerHTML = `<img height="1" width="1" style="display:none;" alt="" src="https://ct.pinterest.com/v3/?event=init&tid=${pixelId}&noscript=1" />`;
    document.body.appendChild(noscript);
    
    this.loadedPixels.add('pinterest');
  }

  // KWAI PIXEL (OFICIAL - KWAI ADS)
  private loadKawaiPixel(pixelId: string) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.loadedPixels.has('kawai')) return;
    
    
    // Script oficial do Kwai Ads (baseado na documentação oficial 2024)
    const script = document.createElement('script');
    script.innerHTML = `
      !function(w, d, t) {
        w.KwaiAnalyticsObject = t;
        var kpq = w[t] = w[t] || [];
        
        var script = d.createElement('script');
        script.type = 'text/javascript';
        script.async = true;
        script.src = 'https://static.kwai.net/pixel/events.js';
        
        var firstScript = d.getElementsByTagName('script')[0];
        firstScript.parentNode.insertBefore(script, firstScript);
        
        kpq.push(['init', '${pixelId}']);
      }(window, document, 'kpq');
    `;
    document.head.appendChild(script);
    
    this.loadedPixels.add('kawai');
  }

  // DISPARAR EVENTO: PAGE VIEW
  public trackPageView() {
    if (typeof window === 'undefined') return;
    
    if (this.firedEvents.has('pageView')) {
      console.log('[PIXEL] trackPageView: JA disparado - pulando duplicata');
      return;
    }
    this.firedEvents.add('pageView');
    
    if (this.managedPixels.length > 0) {
      console.log(`[PIXEL] trackPageView: ${this.managedPixels.length} managed pixels encontrados`);
      this.managedPixels.forEach(pixel => {
        if (!pixel.enabled || pixel.events?.pageView === false) {
          return;
        }
        
        switch (pixel.platform) {
          case 'tiktok':
            if ((window as any).ttq) (window as any).ttq.page();
            break;
          case 'facebook':
            console.log(`[PIXEL] trackPageView: Facebook fbq disponivel=${!!(window as any).fbq}`);
            if ((window as any).fbq && pixel.pixelId) {
              (window as any).fbq('trackSingle', pixel.pixelId, 'PageView');
              console.log('[PIXEL] trackPageView: Facebook PageView disparado para pixel', pixel.pixelId);
            }
            break;
          case 'google_ads':
            if ((window as any).gtag) (window as any).gtag('event', 'page_view');
            break;
          case 'google_analytics_4':
            if ((window as any).gtag) (window as any).gtag('event', 'page_view');
            break;
          case 'pinterest':
            if ((window as any).pintrk) (window as any).pintrk('page');
            break;
          case 'kwai':
            if ((window as any).kpq) (window as any).kpq.push(['track', 'PageView']);
            break;
        }
      });
      return;
    }
    
    // ✅ MODO LEGACY: Dispara todos eventos (backward compatibility)
    if (this.config.tiktokPixel && (window as any).ttq) {
      (window as any).ttq.page();
    }
    
    if (this.config.facebookPixel && (window as any).fbq) {
      (window as any).fbq('track', 'PageView');
    }
    
    if (this.config.googleAdsId && (window as any).gtag) {
      (window as any).gtag('event', 'page_view');
    }
    
    if (this.config.googleAnalytics4Id && (window as any).gtag) {
      (window as any).gtag('event', 'page_view');
    }
    
    if (this.config.pinterestPixel && (window as any).pintrk) {
      (window as any).pintrk('page');
    }
    
    if (this.config.kawaiPixel && (window as any).kpq) {
      (window as any).kpq.push(['track', 'PageView']);
    }
  }

  public trackViewContent(value: number, currency: string, productName: string, productId?: string) {
    if (typeof window === 'undefined') return;
    
    if (this.firedEvents.has('viewContent')) {
      console.log('[PIXEL] trackViewContent: JA disparado - pulando duplicata');
      return;
    }
    this.firedEvents.add('viewContent');
    
    const valueInMajor = value / 100;
    
    if (this.managedPixels.length > 0) {
      this.managedPixels.forEach(pixel => {
        if (!pixel.enabled || pixel.events?.viewContent === false) return;
        
        switch (pixel.platform) {
          case 'facebook':
            if ((window as any).fbq && pixel.pixelId) (window as any).fbq('trackSingle', pixel.pixelId, 'ViewContent', {
              value: valueInMajor,
              currency: currency,
              content_name: productName,
              content_ids: productId ? [productId] : undefined,
              content_type: 'product'
            });
            break;
          case 'tiktok':
            if ((window as any).ttq) (window as any).ttq.track('ViewContent', {
              value: valueInMajor,
              currency: currency,
              content_name: productName,
              content_id: productId
            });
            break;
          case 'google_ads':
            if ((window as any).gtag) (window as any).gtag('event', 'view_item', {
              value: valueInMajor,
              currency: currency,
              items: [{ name: productName, id: productId }]
            });
            break;
          case 'google_analytics_4':
            if ((window as any).gtag) (window as any).gtag('event', 'view_item', {
              value: valueInMajor,
              currency: currency,
              items: [{ item_name: productName, item_id: productId, price: valueInMajor }]
            });
            break;
          case 'pinterest':
            if ((window as any).pintrk) (window as any).pintrk('track', 'pagevisit', {
              value: valueInMajor,
              currency: currency
            });
            break;
          case 'kwai':
            if ((window as any).kpq) (window as any).kpq.push(['track', 'ViewContent', {
              value: valueInMajor,
              currency: currency
            }]);
            break;
        }
      });
      return;
    }
    
    if (this.config.facebookPixel && (window as any).fbq) {
      (window as any).fbq('track', 'ViewContent', {
        value: valueInMajor,
        currency: currency,
        content_name: productName,
        content_ids: productId ? [productId] : undefined,
        content_type: 'product'
      });
    }
    if (this.config.tiktokPixel && (window as any).ttq) {
      (window as any).ttq.track('ViewContent', {
        value: valueInMajor,
        currency: currency,
        content_name: productName,
        content_id: productId
      });
    }
    if (this.config.googleAdsId && (window as any).gtag) {
      (window as any).gtag('event', 'view_item', {
        value: valueInMajor,
        currency: currency,
        items: [{ name: productName, id: productId }]
      });
    }
    if (this.config.googleAnalytics4Id && (window as any).gtag) {
      (window as any).gtag('event', 'view_item', {
        value: valueInMajor,
        currency: currency,
        items: [{ item_name: productName, item_id: productId, price: valueInMajor }]
      });
    }
    if (this.config.pinterestPixel && (window as any).pintrk) {
      (window as any).pintrk('track', 'pagevisit', {
        value: valueInMajor,
        currency: currency
      });
    }
    if (this.config.kawaiPixel && (window as any).kpq) {
      (window as any).kpq.push(['track', 'ViewContent', {
        value: valueInMajor,
        currency: currency
      }]);
    }
  }

  public trackInitiateCheckout(value: number, currency: string, productName: string) {
    if (typeof window === 'undefined') return;
    
    if (this.firedEvents.has('initiateCheckout')) {
      console.log('[PIXEL] trackInitiateCheckout: JA disparado - pulando duplicata');
      return;
    }
    this.firedEvents.add('initiateCheckout');
    
    const valueInMajor = value / 100;
    
    if (this.managedPixels.length > 0) {
      this.managedPixels.forEach(pixel => {
        if (!pixel.enabled || pixel.events?.initiateCheckout === false) return;
        
        switch (pixel.platform) {
          case 'tiktok':
            if ((window as any).ttq) (window as any).ttq.track('InitiateCheckout', {
              value: valueInMajor,
              currency: currency,
              content_name: productName
            });
            break;
          case 'facebook':
            if ((window as any).fbq && pixel.pixelId) (window as any).fbq('trackSingle', pixel.pixelId, 'InitiateCheckout', {
              value: valueInMajor,
              currency: currency,
              content_name: productName
            });
            break;
          case 'google_ads':
            if ((window as any).gtag) (window as any).gtag('event', 'begin_checkout', {
              value: valueInMajor,
              currency: currency,
              items: [{ name: productName }]
            });
            break;
          case 'google_analytics_4':
            if ((window as any).gtag) (window as any).gtag('event', 'begin_checkout', {
              value: valueInMajor,
              currency: currency,
              items: [{ item_name: productName, price: valueInMajor }]
            });
            break;
          case 'pinterest':
            if ((window as any).pintrk) (window as any).pintrk('track', 'checkout', {
              value: valueInMajor,
              currency: currency
            });
            break;
          case 'kwai':
            if ((window as any).kpq) (window as any).kpq.push(['track', 'InitiateCheckout', {
              value: valueInMajor,
              currency: currency
            }]);
            break;
        }
      });
      return;
    }
    
    // ✅ MODO LEGACY: Dispara todos eventos (backward compatibility)
    if (this.config.tiktokPixel && (window as any).ttq) {
      (window as any).ttq.track('InitiateCheckout', {
        value: valueInMajor,
        currency: currency,
        content_name: productName
      });
    }
    
    if (this.config.facebookPixel && (window as any).fbq) {
      (window as any).fbq('track', 'InitiateCheckout', {
        value: valueInMajor,
        currency: currency,
        content_name: productName
      });
    }
    
    if (this.config.googleAdsId && (window as any).gtag) {
      (window as any).gtag('event', 'begin_checkout', {
        value: valueInMajor,
        currency: currency,
        items: [{ name: productName }]
      });
    }
    
    if (this.config.googleAnalytics4Id && (window as any).gtag) {
      (window as any).gtag('event', 'begin_checkout', {
        value: valueInMajor,
        currency: currency,
        items: [{
          item_name: productName,
          price: valueInMajor
        }]
      });
    }
    
    if (this.config.pinterestPixel && (window as any).pintrk) {
      (window as any).pintrk('track', 'checkout', {
        value: valueInMajor,
        currency: currency
      });
    }
    
    if (this.config.kawaiPixel && (window as any).kpq) {
      (window as any).kpq.push(['track', 'InitiateCheckout', {
        value: valueInMajor,
        currency: currency
      }]);
    }
  }

  public trackAddPaymentInfo(value: number, currency: string, paymentMethod: string) {
    if (typeof window === 'undefined') return;
    
    const paymentKey = `addPaymentInfo:${paymentMethod}`;
    if (this.firedEvents.has(paymentKey)) {
      console.log('[PIXEL] trackAddPaymentInfo: JA disparado para', paymentMethod, '- pulando duplicata');
      return;
    }
    this.firedEvents.add(paymentKey);
    
    const valueInMajor = value / 100;
    
    if (this.managedPixels.length > 0) {
      this.managedPixels.forEach(pixel => {
        if (!pixel.enabled || pixel.events?.addPaymentInfo === false) return;
        
        switch (pixel.platform) {
          case 'facebook':
            if ((window as any).fbq && pixel.pixelId) (window as any).fbq('trackSingle', pixel.pixelId, 'AddPaymentInfo', {
              value: valueInMajor,
              currency: currency,
              content_category: paymentMethod
            });
            break;
          case 'tiktok':
            if ((window as any).ttq) (window as any).ttq.track('AddPaymentInfo', {
              value: valueInMajor,
              currency: currency,
              content_category: paymentMethod
            });
            break;
          case 'google_ads':
            if ((window as any).gtag) (window as any).gtag('event', 'add_payment_info', {
              value: valueInMajor,
              currency: currency,
              payment_type: paymentMethod
            });
            break;
          case 'google_analytics_4':
            if ((window as any).gtag) (window as any).gtag('event', 'add_payment_info', {
              value: valueInMajor,
              currency: currency,
              payment_type: paymentMethod
            });
            break;
          case 'pinterest':
            if ((window as any).pintrk) (window as any).pintrk('track', 'addtocart', {
              value: valueInMajor,
              currency: currency
            });
            break;
          case 'kwai':
            if ((window as any).kpq) (window as any).kpq.push(['track', 'AddPaymentInfo', {
              value: valueInMajor,
              currency: currency
            }]);
            break;
        }
      });
      return;
    }
    
    if (this.config.facebookPixel && (window as any).fbq) {
      (window as any).fbq('track', 'AddPaymentInfo', {
        value: valueInMajor,
        currency: currency,
        content_category: paymentMethod
      });
    }
    
    if (this.config.tiktokPixel && (window as any).ttq) {
      (window as any).ttq.track('AddPaymentInfo', {
        value: valueInMajor,
        currency: currency,
        content_category: paymentMethod
      });
    }
    
    if (this.config.googleAdsId && (window as any).gtag) {
      (window as any).gtag('event', 'add_payment_info', {
        value: valueInMajor,
        currency: currency,
        payment_type: paymentMethod
      });
    }
    
    if (this.config.googleAnalytics4Id && (window as any).gtag) {
      (window as any).gtag('event', 'add_payment_info', {
        value: valueInMajor,
        currency: currency,
        payment_type: paymentMethod
      });
    }
    
    if (this.config.pinterestPixel && (window as any).pintrk) {
      (window as any).pintrk('track', 'addtocart', {
        value: valueInMajor,
        currency: currency
      });
    }
    
    if (this.config.kawaiPixel && (window as any).kpq) {
      (window as any).kpq.push(['track', 'AddPaymentInfo', {
        value: valueInMajor,
        currency: currency
      }]);
    }
  }

  // DISPARAR EVENTO: COMPRA CONFIRMADA
  public trackPurchase(data: PurchaseData) {
    if (typeof window === 'undefined') return;
    
    console.log('[PIXEL] trackPurchase CHAMADO:', {
      transactionId: data.transactionId,
      value: data.value,
      currency: data.currency,
      productName: data.productName,
      managedPixelsCount: this.managedPixels.length,
      hasLegacyConfig: !!(this.config.facebookPixel || this.config.tiktokPixel || this.config.googleAdsId || this.config.googleAnalytics4Id)
    });
    
    const purchaseKey = `purchase:${data.transactionId}`;
    if (this.firedEvents.has(purchaseKey)) {
      console.log('[PIXEL] trackPurchase: JA disparado para transacao', data.transactionId, '- pulando duplicata');
      return;
    }
    this.firedEvents.add(purchaseKey);
    
    const valueInMajor = data.value / 100;
    
    if (this.managedPixels.length > 0) {
      console.log('[PIXEL] trackPurchase: Disparando via managed pixels...');
      this.managedPixels.forEach(pixel => {
        console.log(`[PIXEL] trackPurchase: ${pixel.platform} enabled=${pixel.enabled} events.purchase=${pixel.events?.purchase}`);
        if (!pixel.enabled || pixel.events?.purchase === false) return;
        
        switch (pixel.platform) {
          case 'tiktok':
            if ((window as any).ttq) {
              console.log(`[PIXEL] PURCHASE FIRED: TikTok CompletePayment R$${valueInMajor}`);
              (window as any).ttq.track('CompletePayment', {
                value: valueInMajor,
                currency: data.currency,
                content_name: data.productName,
                content_id: data.productId || data.transactionId
              });
            }
            break;
          case 'facebook':
            if (pixel.pixelId) {
              console.log(`[PIXEL] PURCHASE FIRED: Facebook Purchase R$${valueInMajor} pixel=${pixel.pixelId}`);
              if ((window as any).fbq) {
                (window as any).fbq('trackSingle', pixel.pixelId, 'Purchase', {
                  value: valueInMajor,
                  currency: data.currency,
                  content_name: data.productName,
                  content_ids: [data.productId || data.transactionId]
                }, { eventID: data.transactionId });
                console.log(`[PIXEL] Facebook fbq('trackSingle') Purchase chamado com sucesso`);
              } else {
                console.warn(`[PIXEL] Facebook fbq NAO disponivel - usando fallback noscript`);
                try {
                  const img = new Image(1, 1);
                  img.src = `https://www.facebook.com/tr?id=${pixel.pixelId}&ev=Purchase&cd[value]=${valueInMajor}&cd[currency]=${data.currency}&cd[content_name]=${encodeURIComponent(data.productName)}&noscript=1`;
                } catch (e) {}
              }
            }
            break;
          case 'google_ads':
            if (pixel.conversionLabel && (window as any).gtag) {
              console.log(`[PIXEL] PURCHASE FIRED: Google Ads conversion R$${valueInMajor}`);
              (window as any).gtag('event', 'conversion', {
                send_to: `${pixel.conversionId}/${pixel.conversionLabel}`,
                value: valueInMajor,
                currency: data.currency,
                transaction_id: data.transactionId
              });
            }
            break;
          case 'google_analytics_4':
            if ((window as any).gtag) {
              console.log(`[PIXEL] PURCHASE FIRED: GA4 purchase R$${valueInMajor}`);
              (window as any).gtag('event', 'purchase', {
                value: valueInMajor,
                currency: data.currency,
                transaction_id: data.transactionId,
                items: [{
                  item_id: data.productId || data.transactionId,
                  item_name: data.productName,
                  price: valueInMajor
                }]
              });
            }
            break;
          case 'pinterest':
            if ((window as any).pintrk) {
              console.log(`[PIXEL] PURCHASE FIRED: Pinterest checkout R$${valueInMajor}`);
              (window as any).pintrk('track', 'checkout', {
                value: valueInMajor,
                currency: data.currency,
                order_id: data.transactionId
              });
            }
            break;
          case 'kwai':
            if ((window as any).kpq) {
              console.log(`[PIXEL] PURCHASE FIRED: Kwai Purchase R$${valueInMajor}`);
              (window as any).kpq.push(['track', 'Purchase', {
                value: valueInMajor,
                currency: data.currency,
                transaction_id: data.transactionId
              }]);
            }
            break;
        }
      });
      console.log('[PIXEL] trackPurchase: Managed pixels processados com sucesso');
      return;
    }
    
    console.log('[PIXEL] trackPurchase: Disparando via LEGACY mode...');
    if (this.config.tiktokPixel && (window as any).ttq) {
      console.log('[PIXEL] trackPurchase LEGACY: TikTok CompletePayment disparado');
      (window as any).ttq.track('CompletePayment', {
        value: valueInMajor,
        currency: data.currency,
        content_name: data.productName,
        content_id: data.productId || data.transactionId
      });
    }
    
    if (this.config.facebookPixel) {
      if ((window as any).fbq) {
        console.log('[PIXEL] trackPurchase LEGACY: Facebook Purchase disparado');
        (window as any).fbq('track', 'Purchase', {
          value: valueInMajor,
          currency: data.currency,
          content_name: data.productName,
          content_ids: [data.productId || data.transactionId]
        }, { eventID: data.transactionId });
      } else {
        console.warn('[PIXEL] trackPurchase LEGACY: fbq NAO disponivel - usando noscript fallback');
        try {
          const img = new Image(1, 1);
          img.src = `https://www.facebook.com/tr?id=${this.config.facebookPixel}&ev=Purchase&cd[value]=${valueInMajor}&cd[currency]=${data.currency}&cd[content_name]=${encodeURIComponent(data.productName)}&noscript=1`;
        } catch (e) {}
      }
    }
    
    if (this.config.googleAdsId && this.config.googleAdsLabel && (window as any).gtag) {
      (window as any).gtag('event', 'conversion', {
        send_to: `${this.config.googleAdsId}/${this.config.googleAdsLabel}`,
        value: valueInMajor,
        currency: data.currency,
        transaction_id: data.transactionId
      });
    }
    
    if (this.config.googleAnalytics4Id && (window as any).gtag) {
      (window as any).gtag('event', 'purchase', {
        value: valueInMajor,
        currency: data.currency,
        transaction_id: data.transactionId,
        items: [{
          item_id: data.productId || data.transactionId,
          item_name: data.productName,
          price: valueInMajor
        }]
      });
    }
    
    if (this.config.pinterestPixel && (window as any).pintrk) {
      (window as any).pintrk('track', 'checkout', {
        value: valueInMajor,
        currency: data.currency,
        order_id: data.transactionId
      });
    }
    
    if (this.config.kawaiPixel && (window as any).kpq) {
      (window as any).kpq.push(['track', 'Purchase', {
        value: valueInMajor,
        currency: data.currency,
        transaction_id: data.transactionId
      }]);
    }
  }

  public trackAddToCart(value: number, currency: string, productName: string) {
    if (typeof window === 'undefined') return;
    
    if (this.firedEvents.has('addToCart')) {
      console.log('[PIXEL] trackAddToCart: JA disparado - pulando duplicata');
      return;
    }
    this.firedEvents.add('addToCart');
    
    const valueInMajor = value / 100;
    
    if (this.managedPixels.length > 0) {
      this.managedPixels.forEach(pixel => {
        if (!pixel.enabled || pixel.events?.addToCart === false) return;
        
        switch (pixel.platform) {
          case 'tiktok':
            if ((window as any).ttq) (window as any).ttq.track('AddToCart', {
              value: valueInMajor,
              currency: currency,
              content_name: productName
            });
            break;
          case 'facebook':
            if ((window as any).fbq && pixel.pixelId) (window as any).fbq('trackSingle', pixel.pixelId, 'AddToCart', {
              value: valueInMajor,
              currency: currency,
              content_name: productName
            });
            break;
          case 'google_ads':
            if ((window as any).gtag) (window as any).gtag('event', 'add_to_cart', {
              value: valueInMajor,
              currency: currency,
              items: [{ name: productName }]
            });
            break;
          case 'google_analytics_4':
            if ((window as any).gtag) (window as any).gtag('event', 'add_to_cart', {
              value: valueInMajor,
              currency: currency,
              items: [{ item_name: productName, price: valueInMajor }]
            });
            break;
          case 'pinterest':
            if ((window as any).pintrk) (window as any).pintrk('track', 'addtocart', {
              value: valueInMajor,
              currency: currency
            });
            break;
          case 'kwai':
            if ((window as any).kpq) (window as any).kpq.push(['track', 'AddToCart', {
              value: valueInMajor,
              currency: currency
            }]);
            break;
        }
      });
      return;
    }
    
    // ✅ MODO LEGACY: Dispara todos eventos (backward compatibility)
    if (this.config.tiktokPixel && (window as any).ttq) {
      (window as any).ttq.track('AddToCart', {
        value: valueInMajor,
        currency: currency,
        content_name: productName
      });
    }
    
    if (this.config.facebookPixel && (window as any).fbq) {
      (window as any).fbq('track', 'AddToCart', {
        value: valueInMajor,
        currency: currency,
        content_name: productName
      });
    }
    
    if (this.config.googleAdsId && (window as any).gtag) {
      (window as any).gtag('event', 'add_to_cart', {
        value: valueInMajor,
        currency: currency,
        items: [{ name: productName }]
      });
    }
    
    if (this.config.googleAnalytics4Id && (window as any).gtag) {
      (window as any).gtag('event', 'add_to_cart', {
        value: valueInMajor,
        currency: currency,
        items: [{
          item_name: productName,
          price: valueInMajor
        }]
      });
    }
    
    if (this.config.pinterestPixel && (window as any).pintrk) {
      (window as any).pintrk('track', 'addtocart', {
        value: valueInMajor,
        currency: currency
      });
    }
    
    if (this.config.kawaiPixel && (window as any).kpq) {
      (window as any).kpq.push(['track', 'AddToCart', {
        value: valueInMajor,
        currency: currency
      }]);
    }
  }
}

// DECLARAÇES GLOBAIS PARA TYPESCRIPT
declare global {
  interface Window {
    ttq?: any;
    fbq?: any;
    gtag?: any;
    pintrk?: any;
    kpq?: any; // Kwai Analytics Queue
  }
}

// EXPORTAR SINGLETON E TIPOS
export const pixelTracker = PixelTracker.getInstance();
export type { ManagedPixel, PixelConfig, PurchaseData };
