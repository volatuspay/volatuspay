/**
 * CURRENCY HELPERS - Formatao de moeda brasileira
 * 
 * PADRÃO DO SISTEMA: Todos os valores so armazenados em CENTAVOS
 * - R$ 19,90 1990 centavos
 * - R$ 1.990,00 199000 centavos
 */

/**
 * Formata valor em centavos para moeda brasileira
 * @param cents - Valor em centavos (ex: 1990 = R$ 19,90)
 * @param currency - Código da moeda (padrão: BRL)
 * @returns String formatada (ex: "R$ 19,90")
 */
export function formatCurrency(cents: number, currency: string = "BRL"): string {
  const value = cents / 100;
  
  if (currency === "BRL") {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  
  // Para outras moedas, usar formato internacional
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte valor decimal para centavos
 * @param decimal - Valor decimal (ex: 19.90)
 * @returns Valor em centavos (ex: 1990)
 */
export function toCents(decimal: number | string): number {
  const num = typeof decimal === "string" ? parseFloat(decimal) : decimal;
  return Math.round(num * 100);
}

/**
 * Converte centavos para decimal
 * @param cents - Valor em centavos (ex: 1990)
 * @returns Valor decimal (ex: 19.90)
 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Formata input de preo para exibio enquanto o usuário digita
 * @param value - Valor do input
 * @returns Valor formatado para exibio
 */
export function formatPriceInput(value: string): string {
  // Remove tudo exceto nmeros e ponto
  const cleaned = value.replace(/[^\d.]/g, "");
  
  // Limita a 2 casas decimais
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    return parts[0] + "." + parts.slice(1).join("").slice(0, 2);
  }
  if (parts[1] && parts[1].length > 2) {
    return parts[0] + "." + parts[1].slice(0, 2);
  }
  
  return cleaned;
}
