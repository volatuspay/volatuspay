import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// SISTEMA MONETRIO CURRENCY-SAFE - SEMPRE USA MINOR UNITS (CENTAVOS)
// INVARIANTE: Todos os valores internos so em minor units (integer)

// OBTER EXPOENTE DA MOEDA (ISO 4217)
function getCurrencyExponent(currency: string): number {
  const exponents: Record<string, number> = {
    // Sem decimais (expoente 0)
    'JPY': 0, 'KRW': 0, 'BIF': 0, 'CLP': 0, 'DJF': 0, 'GNF': 0, 'ISK': 0,
    'PYG': 0, 'RWF': 0, 'UGX': 0, 'VND': 0, 'VUV': 0, 'XAF': 0, 'XOF': 0, 'XPF': 0,
    
    // 3 decimais (expoente 3)
    'JOD': 3, 'KWD': 3, 'OMR': 3, 'TND': 3, 'BHD': 3,
    
    // 2 decimais (padrão - expoente 2)
    // BRL, USD, EUR, GBP, CAD, AUD, CHF, etc.
  };
  
  return exponents[currency] ?? 2; // Padrão: 2 decimais
}

// CONVERTER DE MAJOR UNITS (REAIS) PARA MINOR UNITS (CENTAVOS)
export function toMinorUnits(majorAmount: number, currency: string = 'BRL'): number {
  const exponent = getCurrencyExponent(currency);
  return Math.round(majorAmount * Math.pow(10, exponent));
}

// CONVERTER DE MINOR UNITS (CENTAVOS) PARA MAJOR UNITS (REAIS)
export function toMajorUnits(minorAmount: number, currency: string = 'BRL'): number {
  const exponent = getCurrencyExponent(currency);
  return minorAmount / Math.pow(10, exponent);
}

// FORMATAR VALOR A PARTIR DE MINOR UNITS
export function formatFromMinorUnits(minorAmount: number, currency: string = 'BRL', locale?: string): string {
  const majorAmount = toMajorUnits(minorAmount, currency);
  const exponent = getCurrencyExponent(currency);
  
  // DETECTAR LOCALE BASEADO NA MOEDA SE NÃO ESPECIFICADO
  if (!locale) {
    switch (currency) {
      case 'USD': locale = 'en-US'; break;
      case 'EUR': locale = 'de-DE'; break;
      case 'GBP': locale = 'en-GB'; break;
      case 'JPY': locale = 'ja-JP'; break;
      case 'KRW': locale = 'ko-KR'; break;
      case 'CAD': locale = 'en-CA'; break;
      case 'AUD': locale = 'en-AU'; break;
      case 'CNY': locale = 'zh-CN'; break;
      case 'INR': locale = 'en-IN'; break;
      case 'BRL': 
      default: locale = 'pt-BR'; break;
    }
  }
  
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent
  }).format(majorAmount);
}

// FUNÇÃO LEGACY REMOVIDA - USAVA HEURSTICA PERIGOSA
// Substitua normalizeAmountByCurrency por toMinorUnits/toMajorUnits explicitamente

// FORMATAÇÃO BRASILEIRA SEGURA (ASSUME MINOR UNITS)
export function formatBRL(minorAmount: number): string {
  return formatFromMinorUnits(minorAmount, 'BRL');
}

// FUNÇÃO LEGACY PARA COMPATIBILIDADE - DETECTA AUTOMATICAMENTE
// DESCONTINUADA: Prefira formatFromMinorUnits para valores em centavos
export function formatBRLLegacy(amount: any): string {
  // Se é nmero com decimais, assume que estem reais e converte para centavos
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!numericAmount || numericAmount === 0) return formatBRL(0);
  
  // Se tem decimais, estem reais (major) - converte para centavos (minor)
  const hasDecimals = !Number.isInteger(numericAmount);
  if (hasDecimals) {
    return formatBRL(toMinorUnits(numericAmount, 'BRL'));
  }
  
  // Se é inteiro, assumimos que jestem centavos (minor)
  return formatBRL(numericAmount);
}

// FORMATAÇÃO UNIVERSAL SEGURA (ASSUME MINOR UNITS)
export function formatCurrency(minorAmount: number, currency: string = 'BRL', locale?: string): string {
  return formatFromMinorUnits(minorAmount, currency, locale);
}

// FUNÇÃO LEGACY PARA COMPATIBILIDADE - DETECTA AUTOMATICAMENTE
// DESCONTINUADA: Prefira formatFromMinorUnits para valores em minor units
export function formatCurrencyLegacy(amount: any, currency: string = 'BRL', locale?: string): string {
  // Se é nmero com decimais, assume que estem major units e converte para minor
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!numericAmount || numericAmount === 0) return formatCurrency(0, currency, locale);
  
  // Se tem decimais, estem major units - converte para minor units
  const hasDecimals = !Number.isInteger(numericAmount);
  if (hasDecimals) {
    return formatCurrency(toMinorUnits(numericAmount, currency), currency, locale);
  }
  
  // Se é inteiro, assumimos que jestem minor units
  return formatCurrency(numericAmount, currency, locale);
}

// FORMATAÇÃO BRASILEIRA SEM SMBOLO (ASSUME MINOR UNITS)
export function formatBRLNumber(minorAmount: number): string {
  const majorAmount = toMajorUnits(minorAmount, 'BRL');
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(majorAmount);
}

// VERSES LEGACY MANTIDAS PARA COMPATIBILIDADE (DEPRECATED)
// FUNÇÃO LEGACY - MANTIDA PARA COMPATIBILIDADE
export function formatBRLCents(amountInCents: number): string {
  return formatBRL(amountInCents);
}

export function formatCurrencyCents(amountInCents: number, currency: string = 'BRL', locale?: string): string {
  if (!locale) {
    switch (currency) {
      case 'USD': locale = 'en-US'; break;
      case 'EUR': locale = 'en-GB'; break;
      case 'GBP': locale = 'en-GB'; break;
      case 'JPY': locale = 'ja-JP'; break;
      case 'KRW': locale = 'ko-KR'; break;
      case 'BRL': 
      default: locale = 'pt-BR'; break;
    }
  }
  
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: ['JPY', 'KRW'].includes(currency) ? 0 : 2,
    maximumFractionDigits: ['JPY', 'KRW'].includes(currency) ? 0 : 2
  }).format(amountInCents / 100);
}
