import { checkoutAnalyticsTracker, AnalyticsEventType } from './checkout-analytics-tracking';

export type CheckoutAnalyticsEvent = 
  | 'pageView' 
  | 'formFilled' 
  | 'paymentClicked'
  | 'efibankSdkTokenSuccess'
  | 'efibankSdkTokenTimeout'
  | 'efibankBackendFallbackSuccess'
  | 'efibankTokenizationTotalFailure';

const eventMapping: Record<string, AnalyticsEventType | null> = {
  'pageView': 'checkout_pageview',
  'formFilled': 'checkout_initiated',
  'paymentClicked': 'purchase_button_click',
  'efibankSdkTokenSuccess': null,
  'efibankSdkTokenTimeout': null,
  'efibankBackendFallbackSuccess': null,
  'efibankTokenizationTotalFailure': null,
};

export async function trackCheckoutAnalytics(
  checkoutId: string, 
  event: CheckoutAnalyticsEvent,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const mappedEvent = eventMapping[event];
    
    if (mappedEvent) {
      await checkoutAnalyticsTracker.track(mappedEvent, {
        originalEvent: event,
        ...metadata,
      });
      console.log(`📊 ANALYTICS TRACKED: ${event} → ${mappedEvent} (checkout: ${checkoutId})`);
    } else {
      console.log(`📊 Telemetry event ignored: ${event} (não mapeado para analytics)`);
    }
  } catch (error) {
    console.warn('⚠️ Erro ao rastrear analytics:', error);
  }
}
