/**
 * 💰 SERVER-SIDE PRICING - CÁLCULO AUTORITATIVO DE PREÇOS
 * Previne manipulação client-side de preços, taxas e descontos
 */

import { getFirestore } from '../lib/firebase-admin';
import crypto from 'crypto';

interface PriceQuote {
  quoteId: string;
  productId: string;
  basePrice: number;
  currency: string;
  quantity: number;
  fees: {
    payment: number;
    platform: number;
    installments?: number;
  };
  discounts: {
    coupon?: number;
    affiliate?: number;
  };
  totalAmount: number;
  hmac: string;
  expiresAt: number;
  createdAt: number;
}

// 🔐 SECRET PARA HMAC (rotaciona a cada 24h)
let HMAC_SECRET = crypto.randomBytes(32).toString('hex');

setInterval(() => {
  HMAC_SECRET = crypto.randomBytes(32).toString('hex');
  console.log('🔄 HMAC secret rotacionado');
}, 24 * 60 * 60 * 1000);

// 💾 ARMAZENAMENTO DE QUOTES (em memória, expira em 15 min)
const quotes = new Map<string, PriceQuote>();

// 🧹 CLEANUP DE QUOTES EXPIRADOS
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  
  for (const [quoteId, quote] of quotes.entries()) {
    if (quote.expiresAt < now) {
      quotes.delete(quoteId);
      removed++;
    }
  }
  
  if (removed > 0) {
    console.log(`🧹 Price quotes cleanup: ${removed} quotes expirados removidos`);
  }
}, 5 * 60 * 1000);

/**
 * 💰 CALCULAR PREÇO TOTAL (AUTORITATIVO)
 */
export async function computeAmount(params: {
  productId: string;
  quantity?: number;
  couponCode?: string;
  affiliateCode?: string;
  paymentMethod?: 'pix' | 'credit_card';
  installments?: number;
  currency?: string;
}): Promise<{
  basePrice: number;
  currency: string;
  quantity: number;
  fees: any;
  discounts: any;
  totalAmount: number;
}> {
  const db = getFirestore();

  try {
    // 1️⃣ BUSCAR PRODUTO (preço real do banco)
    const productDoc = await db.collection('products').doc(params.productId).get();
    
    if (!productDoc.exists) {
      throw new Error('Produto não encontrado');
    }

    const product = productDoc.data();
    const basePrice = product?.price || 0;
    const currency = params.currency || product?.currency || 'BRL';
    const quantity = params.quantity || 1;

    // 2️⃣ CALCULAR TAXAS
    const fees: any = {
      payment: 0,
      platform: 0,
      installments: 0
    };

    // Taxa de pagamento (%)
    if (params.paymentMethod === 'pix') {
      fees.payment = basePrice * 0.01; // 1% Pix
    } else if (params.paymentMethod === 'credit_card') {
      fees.payment = basePrice * 0.029; // 2.9% Cartão
      
      // Taxa de parcelamento (juros)
      if (params.installments && params.installments > 1) {
        const installmentFee = 0.0199; // 1.99% ao mês
        fees.installments = basePrice * installmentFee * (params.installments - 1);
      }
    }

    // 3️⃣ CALCULAR DESCONTOS
    const discounts: any = {
      coupon: 0,
      affiliate: 0
    };

    // Desconto de cupom
    if (params.couponCode) {
      const couponDoc = await db.collection('coupons')
        .where('code', '==', params.couponCode)
        .where('active', '==', true)
        .limit(1)
        .get();

      if (!couponDoc.empty) {
        const coupon = couponDoc.docs[0].data();
        const now = new Date();
        const expiresAt = coupon.expiresAt?.toDate();

        if (!expiresAt || expiresAt > now) {
          if (coupon.type === 'percentage') {
            discounts.coupon = basePrice * (coupon.value / 100);
          } else if (coupon.type === 'fixed') {
            discounts.coupon = coupon.value;
          }
          console.log(`💰 Cupom aplicado: ${params.couponCode} (${coupon.value})`);
        }
      }
    }

    // Desconto de afiliado (se aplicável)
    if (params.affiliateCode) {
      const affiliateDoc = await db.collection('affiliates')
        .where('code', '==', params.affiliateCode)
        .where('active', '==', true)
        .limit(1)
        .get();

      if (!affiliateDoc.empty) {
        const affiliate = affiliateDoc.docs[0].data();
        if (affiliate.commission) {
          discounts.affiliate = basePrice * (affiliate.commission / 100);
          console.log(`🤝 Afiliado: ${params.affiliateCode} (${affiliate.commission}% comissão)`);
        }
      }
    }

    // 4️⃣ CALCULAR TOTAL
    const subtotal = basePrice * quantity;
    const totalFees = fees.payment + fees.platform + (fees.installments || 0);
    const totalDiscounts = discounts.coupon + discounts.affiliate;
    const totalAmount = subtotal + totalFees - totalDiscounts;

    console.log(`💰 Preço calculado: R$ ${basePrice} x ${quantity} + taxas R$ ${totalFees.toFixed(2)} - descontos R$ ${totalDiscounts.toFixed(2)} = R$ ${totalAmount.toFixed(2)}`);

    return {
      basePrice,
      currency,
      quantity,
      fees,
      discounts,
      totalAmount: Math.max(0, totalAmount) // Nunca negativo
    };
  } catch (error) {
    console.error(`❌ Error computing amount:`, error);
    throw error;
  }
}

/**
 * 🎫 CRIAR QUOTE DE PREÇO (HMAC-SIGNED)
 */
export async function createPriceQuote(params: {
  productId: string;
  quantity?: number;
  couponCode?: string;
  affiliateCode?: string;
  paymentMethod?: 'pix' | 'credit_card';
  installments?: number;
  currency?: string;
}): Promise<PriceQuote> {
  try {
    // Calcular preço autoritativo
    const pricing = await computeAmount(params);

    // Gerar quote ID único
    const quoteId = crypto.randomBytes(16).toString('hex');

    // Criar HMAC do quote para prevenir adulteração
    const hmacData = JSON.stringify({
      quoteId,
      productId: params.productId,
      totalAmount: pricing.totalAmount,
      quantity: pricing.quantity
    });

    const hmac = crypto
      .createHmac('sha256', HMAC_SECRET)
      .update(hmacData)
      .digest('hex');

    const quote: PriceQuote = {
      quoteId,
      productId: params.productId,
      basePrice: pricing.basePrice,
      currency: pricing.currency,
      quantity: pricing.quantity,
      fees: pricing.fees,
      discounts: pricing.discounts,
      totalAmount: pricing.totalAmount,
      hmac,
      expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutos
      createdAt: Date.now()
    };

    // Armazenar quote
    quotes.set(quoteId, quote);

    console.log(`✅ Quote criado: ${quoteId} para produto ${params.productId} - R$ ${pricing.totalAmount.toFixed(2)}`);

    return quote;
  } catch (error) {
    console.error(`❌ Error creating price quote:`, error);
    throw error;
  }
}

/**
 * ✅ VALIDAR QUOTE E VERIFICAR HMAC
 */
export function validatePriceQuote(
  quoteId: string,
  expectedProductId: string,
  expectedAmount: number
): PriceQuote | null {
  const quote = quotes.get(quoteId);

  if (!quote) {
    console.warn(`❌ Quote não encontrado: ${quoteId}`);
    return null;
  }

  // Verificar expiração
  if (quote.expiresAt < Date.now()) {
    console.warn(`❌ Quote expirado: ${quoteId}`);
    quotes.delete(quoteId);
    return null;
  }

  // Verificar product ID
  if (quote.productId !== expectedProductId) {
    console.warn(`❌ Product ID mismatch no quote ${quoteId}`);
    return null;
  }

  // Verificar HMAC
  const hmacData = JSON.stringify({
    quoteId: quote.quoteId,
    productId: quote.productId,
    totalAmount: quote.totalAmount,
    quantity: quote.quantity
  });

  const expectedHmac = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(hmacData)
    .digest('hex');

  if (quote.hmac !== expectedHmac) {
    console.warn(`❌ HMAC mismatch no quote ${quoteId} - possível adulteração`);
    return null;
  }

  // Verificar valor (tolerância de 0.01 para diferenças de arredondamento)
  const tolerance = 0.01;
  if (Math.abs(quote.totalAmount - expectedAmount) > tolerance) {
    console.warn(`❌ Amount mismatch no quote ${quoteId}: esperado ${expectedAmount}, quote ${quote.totalAmount}`);
    return null;
  }

  console.log(`✅ Quote válido: ${quoteId} - R$ ${quote.totalAmount.toFixed(2)}`);
  return quote;
}

/**
 * 🔒 VALIDAR PREÇO NO SERVER (para ordens)
 * Recomputa e compara com valor enviado pelo cliente
 */
export async function validateOrderPrice(params: {
  productId: string;
  quantity?: number;
  couponCode?: string;
  affiliateCode?: string;
  paymentMethod?: 'pix' | 'credit_card';
  installments?: number;
  clientAmount: number;
  quoteId?: string;
}): Promise<{
  isValid: boolean;
  serverAmount: number;
  clientAmount: number;
  difference?: number;
}> {
  try {
    // 1️⃣ Se houver quoteId, validar primeiro
    if (params.quoteId) {
      const quote = validatePriceQuote(
        params.quoteId,
        params.productId,
        params.clientAmount
      );

      if (quote) {
        return {
          isValid: true,
          serverAmount: quote.totalAmount,
          clientAmount: params.clientAmount
        };
      }

      console.warn(`⚠️ Quote inválido ou expirado, recalculando...`);
    }

    // 2️⃣ Recalcular preço no servidor
    const pricing = await computeAmount({
      productId: params.productId,
      quantity: params.quantity,
      couponCode: params.couponCode,
      affiliateCode: params.affiliateCode,
      paymentMethod: params.paymentMethod,
      installments: params.installments
    });

    const serverAmount = pricing.totalAmount;
    const tolerance = 0.02; // 2 centavos de tolerância
    const difference = Math.abs(serverAmount - params.clientAmount);

    const isValid = difference <= tolerance;

    if (!isValid) {
      console.error(`🚨 PRICE MANIPULATION DETECTED: Client sent R$ ${params.clientAmount}, server calculated R$ ${serverAmount} (diff: R$ ${difference.toFixed(2)})`);
    } else {
      console.log(`✅ Preço validado: Cliente R$ ${params.clientAmount}, Server R$ ${serverAmount}`);
    }

    return {
      isValid,
      serverAmount,
      clientAmount: params.clientAmount,
      difference: isValid ? undefined : difference
    };
  } catch (error) {
    console.error(`❌ Error validating order price:`, error);
    throw error;
  }
}

/**
 * 📊 ESTATÍSTICAS DE QUOTES
 */
export function getPriceQuoteStats() {
  const now = Date.now();
  let active = 0;
  let expired = 0;

  for (const quote of quotes.values()) {
    if (quote.expiresAt > now) {
      active++;
    } else {
      expired++;
    }
  }

  return {
    total: quotes.size,
    active,
    expired
  };
}

/**
 * 🧹 LIMPAR QUOTES (para testes)
 */
export function clearPriceQuotes(): number {
  const size = quotes.size;
  quotes.clear();
  console.log(`🧹 ${size} price quotes limpos`);
  return size;
}
