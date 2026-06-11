/**
 * 💰 FINANCIAL VALIDATOR
 * 
 * Helper centralizado para validar valores financeiros em TODO o sistema.
 * NÃO ALTERA LÓGICA EXISTENTE - apenas adiciona logs e validações.
 * 
 * REGRAS CRÍTICAS:
 * 1. Todos os valores DEVEM estar em CENTAVOS (integer)
 * 2. checkout.pricing.amount = CENTAVOS (ex: 500 = R$ 5,00)
 * 3. API recebe valores em CENTAVOS
 * 4. Firestore armazena valores em CENTAVOS
 * 5. Dashboard exibe valores/100 para converter para REAIS
 */

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  value: number;
}

interface FeeCalculation {
  grossAmount: number; // Valor bruto em centavos
  percentFee: number; // Percentual da taxa (ex: 3 = 3%)
  fixedFee: number; // Taxa fixa em centavos
  percentFeeAmount: number; // Valor da taxa percentual em centavos
  totalFee: number; // Taxa total em centavos
  netAmount: number; // Valor líquido em centavos
}

interface CommissionCalculation {
  grossAmount: number; // Valor bruto da venda em centavos
  commissionPercent: number; // Percentual de comissão (ex: 10 = 10%)
  commissionAmount: number; // Valor da comissão em centavos
}

/**
 * Valida se um valor está em centavos (integer positivo)
 */
export function validateCentavos(value: any, fieldName: string = 'value'): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Verificar se é número
  if (typeof value !== 'number') {
    errors.push(`${fieldName} não é um número (tipo: ${typeof value})`);
    return { isValid: false, errors, warnings, value: 0 };
  }
  
  // Verificar se é inteiro
  if (!Number.isInteger(value)) {
    errors.push(`${fieldName} não é inteiro (${value}) - centavos devem ser integers`);
    return { isValid: false, errors, warnings, value: 0 };
  }
  
  // Verificar se é positivo
  if (value < 0) {
    errors.push(`${fieldName} é negativo (${value}) - valores financeiros devem ser positivos`);
    return { isValid: false, errors, warnings, value: 0 };
  }
  
  // Verificar se é zero (warning, não erro)
  if (value === 0) {
    warnings.push(`${fieldName} é zero - pode ser intencional para produtos grátis`);
  }
  
  // Verificar se valor é muito alto (possível bug de conversão)
  if (value > 100000000) { // > R$ 1.000.000,00
    warnings.push(`${fieldName} muito alto (R$ ${(value/100).toFixed(2)}) - verificar se não foi convertido errado`);
  }
  
  console.log(`✅ [VALIDATOR] ${fieldName} válido: ${value} centavos (R$ ${(value/100).toFixed(2)})`);
  
  return { isValid: true, errors, warnings, value };
}

/**
 * Calcula taxas de gateway sobre valor em centavos
 * Fórmula: netAmount = grossAmount - (grossAmount * percentFee/100) - fixedFee
 */
export function calculateFees(
  grossAmount: number,
  percentFee: number,
  fixedFee: number,
  method: string = 'unknown'
): FeeCalculation {
  console.log(`💰 [FEE CALCULATOR] Iniciando cálculo para método: ${method}`);
  console.log(`   Valor bruto: ${grossAmount} centavos (R$ ${(grossAmount/100).toFixed(2)})`);
  console.log(`   Taxa %: ${percentFee}%`);
  console.log(`   Taxa fixa: ${fixedFee} centavos (R$ ${(fixedFee/100).toFixed(2)})`);
  
  // Validar entrada
  const grossValidation = validateCentavos(grossAmount, 'grossAmount');
  if (!grossValidation.isValid) {
    console.error(`❌ [FEE CALCULATOR] Valor bruto inválido:`, grossValidation.errors);
    throw new Error(`Valor bruto inválido: ${grossValidation.errors.join(', ')}`);
  }
  
  // Calcular taxa percentual em centavos (arredondar para evitar frações)
  const percentFeeAmount = Math.round(grossAmount * (percentFee / 100));
  
  // Calcular taxa total
  const totalFee = percentFeeAmount + fixedFee;
  
  // Calcular valor líquido
  const netAmount = grossAmount - totalFee;
  
  console.log(`   Taxa percentual: ${percentFeeAmount} centavos (R$ ${(percentFeeAmount/100).toFixed(2)})`);
  console.log(`   Taxa total: ${totalFee} centavos (R$ ${(totalFee/100).toFixed(2)})`);
  console.log(`   Valor líquido: ${netAmount} centavos (R$ ${(netAmount/100).toFixed(2)})`);
  
  // Validar que netAmount não é negativo
  if (netAmount < 0) {
    console.error(`❌ [FEE CALCULATOR] Valor líquido negativo! Taxas (${totalFee}) maiores que valor bruto (${grossAmount})`);
    throw new Error(`Taxas muito altas: R$ ${(totalFee/100).toFixed(2)} > R$ ${(grossAmount/100).toFixed(2)}`);
  }
  
  const result: FeeCalculation = {
    grossAmount,
    percentFee,
    fixedFee,
    percentFeeAmount,
    totalFee,
    netAmount
  };
  
  console.log(`✅ [FEE CALCULATOR] Cálculo concluído:`, result);
  return result;
}

/**
 * Calcula comissão de afiliado sobre valor bruto
 * Fórmula: commissionAmount = grossAmount * (commissionPercent / 100)
 */
export function calculateCommission(
  grossAmount: number,
  commissionPercent: number,
  affiliateCode: string = 'unknown'
): CommissionCalculation {
  console.log(`💰 [COMMISSION CALCULATOR] Iniciando cálculo para afiliado: ${affiliateCode}`);
  console.log(`   Valor bruto: ${grossAmount} centavos (R$ ${(grossAmount/100).toFixed(2)})`);
  console.log(`   Comissão %: ${commissionPercent}%`);
  
  // Validar entrada
  const grossValidation = validateCentavos(grossAmount, 'grossAmount');
  if (!grossValidation.isValid) {
    console.error(`❌ [COMMISSION CALCULATOR] Valor bruto inválido:`, grossValidation.errors);
    throw new Error(`Valor bruto inválido: ${grossValidation.errors.join(', ')}`);
  }
  
  // Validar percentual
  if (commissionPercent < 0 || commissionPercent > 100) {
    console.error(`❌ [COMMISSION CALCULATOR] Percentual inválido: ${commissionPercent}%`);
    throw new Error(`Percentual de comissão inválido: ${commissionPercent}% (deve estar entre 0-100)`);
  }
  
  // Calcular comissão em centavos (arredondar para evitar frações)
  const commissionAmount = Math.round(grossAmount * (commissionPercent / 100));
  
  console.log(`   Comissão: ${commissionAmount} centavos (R$ ${(commissionAmount/100).toFixed(2)})`);
  
  const result: CommissionCalculation = {
    grossAmount,
    commissionPercent,
    commissionAmount
  };
  
  console.log(`✅ [COMMISSION CALCULATOR] Cálculo concluído:`, result);
  return result;
}

/**
 * Valida fluxo completo de uma transação
 * Retorna objeto com TODOS os valores calculados
 */
export function validateTransaction(params: {
  amount: number;
  method: 'pix' | 'card' | 'boleto';
  paymentProcessor: string;
  percentFee: number;
  fixedFee: number;
  hasAffiliate?: boolean;
  affiliatePercent?: number;
  affiliateCode?: string;
}) {
  console.log(`🔍 [TRANSACTION VALIDATOR] Validando transação completa:`, params);
  
  // 1. Validar valor principal
  const amountValidation = validateCentavos(params.amount, 'transaction.amount');
  if (!amountValidation.isValid) {
    throw new Error(`Transação inválida: ${amountValidation.errors.join(', ')}`);
  }
  
  // 2. Calcular taxas
  const fees = calculateFees(
    params.amount,
    params.percentFee,
    params.fixedFee,
    `${params.method}-${params.paymentProcessor}`
  );
  
  // 3. Calcular comissão (se houver afiliado)
  let commission: CommissionCalculation | null = null;
  if (params.hasAffiliate && params.affiliatePercent) {
    commission = calculateCommission(
      params.amount,
      params.affiliatePercent,
      params.affiliateCode || 'unknown'
    );
  }
  
  // 4. Validar que vendedor recebe algo
  const sellerNetAmount = commission 
    ? fees.netAmount - commission.commissionAmount
    : fees.netAmount;
    
  if (sellerNetAmount <= 0) {
    console.error(`❌ [TRANSACTION VALIDATOR] Vendedor não recebe nada!`);
    console.error(`   Valor líquido: ${fees.netAmount} centavos`);
    console.error(`   Comissão afiliado: ${commission?.commissionAmount || 0} centavos`);
    console.error(`   Sobra para vendedor: ${sellerNetAmount} centavos`);
    throw new Error(`Transação inválida: vendedor não recebe nada após taxas e comissões`);
  }
  
  const result = {
    isValid: true,
    grossAmount: params.amount,
    fees,
    commission,
    sellerNetAmount,
    breakdown: {
      valorBruto: `R$ ${(params.amount/100).toFixed(2)}`,
      taxasGateway: `R$ ${(fees.totalFee/100).toFixed(2)} (${params.percentFee}% + R$ ${(params.fixedFee/100).toFixed(2)})`,
      valorLiquido: `R$ ${(fees.netAmount/100).toFixed(2)}`,
      comissaoAfiliado: commission ? `R$ ${(commission.commissionAmount/100).toFixed(2)} (${params.affiliatePercent}%)` : 'N/A',
      vendedorRecebe: `R$ ${(sellerNetAmount/100).toFixed(2)}`
    }
  };
  
  console.log(`✅ [TRANSACTION VALIDATOR] Transação válida:`, result.breakdown);
  return result;
}

/**
 * Formata valor em centavos para exibição (R$ X,XX)
 */
export function formatCentavos(centavos: number): string {
  return `R$ ${(centavos/100).toFixed(2)}`.replace('.', ',');
}

/**
 * Converte reais para centavos (com validação)
 */
export function reaisToCentavos(reais: number): number {
  if (typeof reais !== 'number' || isNaN(reais)) {
    throw new Error(`Valor inválido para conversão: ${reais}`);
  }
  
  const centavos = Math.round(reais * 100);
  console.log(`🔄 [CONVERTER] R$ ${reais.toFixed(2)} → ${centavos} centavos`);
  return centavos;
}

/**
 * Converte centavos para reais (com validação)
 */
export function centavosToReais(centavos: number): number {
  const validation = validateCentavos(centavos, 'centavos');
  if (!validation.isValid) {
    throw new Error(`Centavos inválidos: ${validation.errors.join(', ')}`);
  }
  
  const reais = centavos / 100;
  console.log(`🔄 [CONVERTER] ${centavos} centavos → R$ ${reais.toFixed(2)}`);
  return reais;
}
