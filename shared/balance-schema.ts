/**
 * 💰 SCHEMA DE SALDO UNIFICADO - ORÁCULO PAY
 * Sistema híbrido extensível para múltiplas adquirentes
 * 
 * ARQUITETURA:
 * - Saldos separados por método de pagamento e adquirente
 * - Campos computados para saldos totais (atomic updates via FieldValue.increment)
 * - Auditoria completa de todas as movimentações
 * - Extensível para novas adquirentes sem breaking changes
 * 
 * 🔥 IMPORTANTES DECISÕES ARQUITETURAIS:
 * 
 * 1. PRECISÃO MONETÁRIA:
 *    - TODOS os valores são armazenados como INTEGER em CENTAVOS (BRL) ou CENTS (USD/EUR)
 *    - Nunca usar float/number para dinheiro (evita rounding errors)
 *    - Exemplo: R$ 10,50 = 1050 centavos
 * 
 * 2. MULTI-CURRENCY:
 *    - Todo valor monetário TEM campo 'currency' (ISO 4217: BRL, USD, EUR)
 *    - Saldos separados POR MOEDA
 *    - Conversão cambial NUNCA é automática (manual via admin)
 * 
 * 3. ATOMIC UPDATES:
 *    - Contadores frequentes (totals) são top-level para FieldValue.increment()
 *    - Paths diretos: balanceAvailableBRL, balancePendingBRL, etc
 *    - Nested objects são READ-ONLY (recalculados via reconciliação)
 * 
 * 4. FIRESTORE TIMESTAMPS:
 *    - Usar admin.firestore.Timestamp (não Date) para datas
 *    - TypeScript aceita Date mas Firestore salva como Timestamp
 */

/**
 * 💱 MOEDAS SUPORTADAS (ISO 4217)
 */
export type Currency = 'BRL' | 'USD' | 'EUR' | string; // Extensível

/**
 * 🎯 TIPOS DE MÉTODOS DE PAGAMENTO
 */
export type PaymentMethod = 'pix' | 'creditCard' | 'boleto' | 'global';

/**
 * 🏦 ADQUIRENTES SUPORTADAS
 * Extensível - adicionar novas sem quebrar código existente
 */
export type Acquirer = 
  | 'efibank' 
  | 'woovi' 
  | 'stripe' 
  | 'adyen' 
  | 'pagarme' 
  | 'witetec'
  | string; // Permite futuras adquirentes

/**
 * 📊 CATEGORIAS DE VENDAS
 */
export type SaleCategory = 'digital' | 'subscription';

/**
 * 🔄 STATUS DE SAQUE
 */
export type WithdrawalStatus = 
  | 'pending'        // Aguardando aprovação admin
  | 'approved'       // Aprovado pelo admin (aguardando processamento)
  | 'rejected'       // Recusado pelo admin
  | 'processing'     // Em processamento (locked)
  | 'completed'      // Concluído (pagamento realizado)
  | 'failed'         // Falhou (erro no processamento)
  | 'cancelled';     // Cancelado pelo seller

/**
 * 💵 VALOR MONETÁRIO COM MOEDA
 * Sempre em CENTAVOS/CENTS (integer)
 */
export interface MonetaryAmount {
  amount: number;      // SEMPRE EM CENTAVOS (integer: 1050 = R$ 10,50)
  currency: Currency;  // ISO 4217 (BRL, USD, EUR)
}

/**
 * 💵 ESTRUTURA DE SALDO POR ADQUIRENTE E MOEDA
 */
export interface AcquirerBalance {
  acquirer: Acquirer;
  currency: Currency;
  
  available: number;        // Saldo disponível (CENTAVOS)
  pending: number;          // Saldo pendente (CENTAVOS)
  reserved: number;         // Saldo reservado em saques (CENTAVOS)
  
  lastUpdated: any;         // admin.firestore.Timestamp
  transactionCount: number; // Contador de transações
}

/**
 * 💳 SALDO POR MÉTODO DE PAGAMENTO E MOEDA
 */
export interface PaymentMethodBalance {
  method: PaymentMethod;
  currency: Currency;
  
  // Breakdown por adquirente (READ-ONLY - recalculado na reconciliação)
  byAcquirer: {
    [key: string]: AcquirerBalance; // key = acquirer name
  };
  
  // Totais computados (READ-ONLY - recalculado na reconciliação)
  total: {
    available: number;  // CENTAVOS
    pending: number;    // CENTAVOS
    reserved: number;   // CENTAVOS
  };
}

/**
 * 🏪 SALDO POR CATEGORIA DE PRODUTO
 */
export interface CategoryBalance {
  category: SaleCategory;
  currency: Currency;
  
  totalRevenue: number;     // Receita bruta total (CENTAVOS)
  paidRevenue: number;      // Receita confirmada (CENTAVOS)
  pendingRevenue: number;   // Receita pendente (CENTAVOS)
  refundedRevenue: number;  // Receita estornada (CENTAVOS)
  
  // Detalhamento por método (READ-ONLY)
  byMethod: {
    [key: string]: {
      total: number;    // CENTAVOS
      paid: number;     // CENTAVOS
      pending: number;  // CENTAVOS
    };
  };
}

/**
 * 💰 ESTRUTURA PRINCIPAL - SALDO DO SELLER
 * 
 * Firestore: /sellerBalances/{sellerId}
 * 
 * 🔥 IMPORTANT: Atomic Update Strategy
 * 
 * TOP-LEVEL COUNTERS (atomic via FieldValue.increment):
 * - balanceAvailable_BRL, balanceAvailable_USD, etc
 * - balancePending_BRL, balancePending_USD, etc
 * - balanceReserved_BRL, balanceReserved_USD, etc
 * - lifetimeRevenue_BRL, lifetimeRevenue_USD, etc
 * - totalWithdrawn_BRL, totalWithdrawn_USD, etc
 * 
 * NESTED OBJECTS (READ-ONLY, recalculados na reconciliação):
 * - balances.{method}.byAcquirer
 * - byCategory.{category}.byMethod
 * - stats.*
 */
export interface SellerBalance {
  sellerId: string;
  
  // ═══════════════════════════════════════════════════════════
  // 💵 CONTADORES ATÔMICOS - BRL (TOP-LEVEL para FieldValue.increment)
  // ═══════════════════════════════════════════════════════════
  balanceAvailable_BRL: number;   // Saldo disponível em CENTAVOS
  balancePending_BRL: number;     // Saldo pendente em CENTAVOS
  balanceReserved_BRL: number;    // Saldo reservado (saques) em CENTAVOS
  lifetimeRevenue_BRL: number;    // Total de vendas aprovadas (histórico) em CENTAVOS
  totalWithdrawn_BRL: number;     // Total sacado (histórico) em CENTAVOS
  
  // ═══════════════════════════════════════════════════════════
  // 💵 CONTADORES ATÔMICOS - USD (Cartões Globais)
  // ═══════════════════════════════════════════════════════════
  balanceAvailable_USD: number;   // Saldo disponível em CENTS
  balancePending_USD: number;     // Saldo pendente em CENTS
  balanceReserved_USD: number;    // Saldo reservado em CENTS
  lifetimeRevenue_USD: number;    // Total de vendas (histórico) em CENTS
  totalWithdrawn_USD: number;     // Total sacado (histórico) em CENTS
  
  // ═══════════════════════════════════════════════════════════
  // 💵 CONTADORES ATÔMICOS - EUR (Expansão Futura)
  // ═══════════════════════════════════════════════════════════
  balanceAvailable_EUR: number;   // Saldo disponível em CENTS
  balancePending_EUR: number;     // Saldo pendente em CENTS
  balanceReserved_EUR: number;    // Saldo reservado em CENTS
  lifetimeRevenue_EUR: number;    // Total de vendas (histórico) em CENTS
  totalWithdrawn_EUR: number;     // Total sacado (histórico) em CENTS
  
  // ═══════════════════════════════════════════════════════════
  // 📊 BREAKDOWN DETALHADO (READ-ONLY - Recalculado na Reconciliação)
  // ═══════════════════════════════════════════════════════════
  
  // Saldos por método e moeda (BRL)
  balances_BRL: {
    pix: PaymentMethodBalance;
    creditCard: PaymentMethodBalance;
    boleto: PaymentMethodBalance;
  };
  
  // Saldos por método e moeda (USD)
  balances_USD: {
    creditCard: PaymentMethodBalance;  // Apenas cartões globais
  };
  
  // Saldos por método e moeda (EUR)
  balances_EUR: {
    creditCard: PaymentMethodBalance;  // Apenas cartões globais
  };
  
  // ═══════════════════════════════════════════════════════════
  // 🏪 ANÁLISE POR CATEGORIA DE PRODUTO (READ-ONLY)
  // ═══════════════════════════════════════════════════════════
  byCategory_BRL: {
    digital: CategoryBalance;
    subscription: CategoryBalance;
  };
  
  byCategory_USD: {
    digital: CategoryBalance;
    subscription: CategoryBalance;
  };
  
  // ═══════════════════════════════════════════════════════════
  // 📈 ESTATÍSTICAS E METADADOS (Contadores Atômicos)
  // ═══════════════════════════════════════════════════════════
  totalOrders: number;            // Total de vendas (counter)
  approvedOrders: number;         // Vendas aprovadas (counter)
  refundedOrders: number;         // Vendas estornadas (counter)
  chargebackOrders: number;       // Chargebacks (counter)
  
  // Metadados (não-atômicos)
  averageTicket_BRL: number;      // Ticket médio BRL (CENTAVOS)
  averageTicket_USD: number;      // Ticket médio USD (CENTS)
  lastSaleDate: any;              // admin.firestore.Timestamp
  firstSaleDate: any;             // admin.firestore.Timestamp
  
  // ═══════════════════════════════════════════════════════════
  // 🔐 CONTROLE E AUDITORIA
  // ═══════════════════════════════════════════════════════════
  version: number;                // Versão para optimistic locking
  lastReconciliation: any;        // admin.firestore.Timestamp
  lastWithdrawal: any;            // admin.firestore.Timestamp
  createdAt: any;                 // admin.firestore.Timestamp
  updatedAt: any;                 // admin.firestore.Timestamp
}

/**
 * 💼 ESTRUTURA DE SALDO DO AFILIADO
 * 
 * Firestore: /affiliateBalances/{userId}
 * 
 * 🔥 MODELO SIMPLIFICADO (vs SellerBalance):
 * - Afiliados só recebem BRL (comissões de produtos brasileiros)
 * - Apenas 2 estados: pending (aguardando releaseDate) e available (liberado)
 * - Reserved é usado para saques solicitados
 * 
 * 🎯 FLUXO DE COMISSÃO:
 * 1. Venda confirmada → pending (com releaseDate futuro)
 * 2. releaseDate passa → pending → available (via job)
 * 3. Afiliado solicita saque → available → reserved
 * 4. Saque aprovado → reserved → withdrawn (sai do sistema)
 * 
 * ÍNDICES NECESSÁRIOS (Firestore):
 * - userId (UNIQUE)
 * - updatedAt (DESC)
 */
export interface AffiliateBalance {
  userId: string;  // UID do afiliado (Firebase Auth)
  
  // ═══════════════════════════════════════════════════════════
  // 💵 CONTADORES ATÔMICOS - BRL (TOP-LEVEL para FieldValue.increment)
  // ═══════════════════════════════════════════════════════════
  balanceAvailable_BRL: number;   // Saldo disponível para saque (CENTAVOS)
  balancePending_BRL: number;     // Saldo pendente (aguardando releaseDate) em CENTAVOS
  balanceReserved_BRL: number;    // Saldo reservado (saques pendentes) em CENTAVOS
  lifetimeCommissions_BRL: number; // Total de comissões ganhas (histórico) em CENTAVOS
  totalWithdrawn_BRL: number;     // Total sacado (histórico) em CENTAVOS
  
  // ═══════════════════════════════════════════════════════════
  // 📈 ESTATÍSTICAS (Contadores Atômicos)
  // ═══════════════════════════════════════════════════════════
  totalSales: number;             // Total de vendas geradas pelo afiliado
  totalCommissions: number;       // Total de comissões geradas (counter)
  pendingCommissions: number;     // Comissões aguardando liberação
  approvedCommissions: number;    // Comissões aprovadas e disponíveis
  
  // ═══════════════════════════════════════════════════════════
  // 🔐 CONTROLE E AUDITORIA
  // ═══════════════════════════════════════════════════════════
  lastCommissionDate: any;        // admin.firestore.Timestamp - Última comissão recebida
  lastWithdrawal: any;            // admin.firestore.Timestamp - Último saque
  firstCommissionDate: any;       // admin.firestore.Timestamp - Primeira comissão
  createdAt: any;                 // admin.firestore.Timestamp
  updatedAt: any;                 // admin.firestore.Timestamp
}

/**
 * 📝 MOVIMENTAÇÃO DE SALDO
 * 
 * Firestore: /balanceMovements/{movementId}
 * Auditoria completa de todas as mudanças de saldo
 * 
 * ÍNDICES NECESSÁRIOS (Firestore):
 * - sellerId + createdAt (DESC)
 * - sellerId + type + createdAt (DESC)
 * - orderId
 * - withdrawalId
 * - idempotencyKey (UNIQUE)
 */
export interface BalanceMovement {
  movementId: string;
  sellerId: string;
  
  // ═══════════════════════════════════════════════════════════
  // 🎯 TIPO DE MOVIMENTAÇÃO
  // ═══════════════════════════════════════════════════════════
  type: 
    | 'sale_approved'        // Venda aprovada (+ saldo)
    | 'sale_refunded'        // Venda estornada (- saldo)
    | 'sale_chargeback'      // Chargeback (- saldo)
    | 'release'              // Liberação de saldo pendente
    | 'withdrawal_request'   // Solicitação de saque (- disponível, + reservado)
    | 'withdrawal_completed' // Saque concluído (- reservado)
    | 'withdrawal_failed'    // Saque falhou (+ disponível, - reservado)
    | 'adjustment'           // Ajuste manual (admin)
    | 'fee_update';          // Atualização de fee (recálculo)
  
  // ═══════════════════════════════════════════════════════════
  // 💵 VALORES (SEMPRE EM CENTAVOS/CENTS)
  // ═══════════════════════════════════════════════════════════
  amount: number;              // Valor da movimentação em CENTAVOS (sempre positivo)
  currency: Currency;          // Moeda (BRL, USD, EUR)
  direction: 'credit' | 'debit'; // Crédito (+) ou Débito (-)
  
  // Saldos antes e depois (snapshot em CENTAVOS)
  balanceBefore: {
    available: number;   // CENTAVOS
    pending: number;     // CENTAVOS
    reserved: number;    // CENTAVOS
  };
  balanceAfter: {
    available: number;   // CENTAVOS
    pending: number;     // CENTAVOS
    reserved: number;    // CENTAVOS
  };
  
  // ═══════════════════════════════════════════════════════════
  // 🔍 REFERÊNCIAS E CONTEXTO
  // ═══════════════════════════════════════════════════════════
  orderId?: string;            // ID da ordem (se aplicável)
  withdrawalId?: string;       // ID do saque (se aplicável)
  paymentMethod: PaymentMethod;
  acquirer: Acquirer;
  
  // ═══════════════════════════════════════════════════════════
  // 📊 FEE SNAPSHOT (se aplicável - CENTAVOS)
  // ═══════════════════════════════════════════════════════════
  feeSnapshot?: {
    gatewayFee: number;           // CENTAVOS
    platformFee: number;          // CENTAVOS
    netAmount: number;            // CENTAVOS
    gatewayFeePercent: number;    // Percentual (ex: 2.99)
    gatewayFeeFixed: number;      // CENTAVOS (ex: 49 = R$ 0,49)
    platformFeePercent: number;   // Percentual
  };
  
  // ═══════════════════════════════════════════════════════════
  // 🔐 AUDITORIA
  // ═══════════════════════════════════════════════════════════
  processedBy?: string;        // UID do admin (se manual)
  processedByName?: string;
  notes?: string;              // Observações (ajustes manuais)
  createdAt: any;              // admin.firestore.Timestamp
  
  // Idempotência
  idempotencyKey: string;      // Previne duplicatas (UNIQUE)
}

/**
 * 💸 SOLICITAÇÃO DE SAQUE
 * 
 * Firestore: /withdrawals/{withdrawalId}
 * 
 * ÍNDICES NECESSÁRIOS (Firestore):
 * - sellerId + status + requestedAt (DESC)
 * - sellerId + requestedAt (DESC)
 * - status + requestedAt (DESC)
 */
export interface Withdrawal {
  withdrawalId: string;
  sellerId: string;            // UID do seller ou afiliado (LEGADO - usar tenantId)
  tenantId?: string;           // ✅ UID do seller/afiliado (NOVO - campo canônico)
  userType?: 'seller' | 'affiliate'; // 🆕 Tipo de usuário (seller ou afiliado)
  
  // ═══════════════════════════════════════════════════════════
  // 💵 VALORES E BREAKDOWN (CENTAVOS)
  // ═══════════════════════════════════════════════════════════
  amount: number;              // Valor total solicitado em CENTAVOS
  fee?: number;                // 💰 Taxa de saque em CENTAVOS (ex: R$3 = 300)
  currency: Currency;          // Moeda (BRL, USD, EUR)
  
  // Detalhamento por fonte (adquirente + método) em CENTAVOS
  breakdown: {
    [key: string]: number;     // key = `${method}_${acquirer}`, value = CENTAVOS
  };
  
  // ═══════════════════════════════════════════════════════════
  // 📋 STATUS E WORKFLOW
  // ═══════════════════════════════════════════════════════════
  status: WithdrawalStatus;
  
  requestedAt: any;            // admin.firestore.Timestamp
  approvedAt?: any;
  processingAt?: any;
  completedAt?: any;
  failedAt?: any;
  cancelledAt?: any;
  
  // ═══════════════════════════════════════════════════════════
  // 🔑 DADOS PIX (PREFERENCIAL - MAIS SIMPLES)
  // ═══════════════════════════════════════════════════════════
  pixData?: {
    pixKey: string;            // Chave PIX (CPF, CNPJ, email, phone, random)
    pixKeyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
    holderName: string;        // Nome do titular
    holderEmail: string;       // Email do titular
    holderDocument: string;    // CPF ou CNPJ (sem formatação)
  };
  
  // ═══════════════════════════════════════════════════════════
  // 🏦 DADOS BANCÁRIOS TRADICIONAIS (OPCIONAL - FALLBACK)
  // ═══════════════════════════════════════════════════════════
  bankAccount?: {
    bankCode: string;          // Código do banco (001, 237, etc)
    bankName: string;          // Nome do banco
    accountType: 'checking' | 'savings';
    agency: string;
    agencyDigit?: string;
    account: string;
    accountDigit: string;
    cpfCnpj: string;
    holderName: string;
  };
  
  // ═══════════════════════════════════════════════════════════
  // 🔐 APROVAÇÃO E PROCESSAMENTO (MANUAL)
  // ═══════════════════════════════════════════════════════════
  approvedBy?: string;         // UID do admin que aprovid
  approvedByEmail?: string;    // Email do admin
  rejectedBy?: string;         // UID do admin que recusou
  rejectedByEmail?: string;    // Email do admin
  rejectionReason?: string;    // Motivo da recusa
  
  processingBy?: string;       // UID do admin processando
  failureReason?: string;      // Motivo da falha
  cancellationReason?: string; // Motivo do cancelamento
  
  // ═══════════════════════════════════════════════════════════
  // 📊 COMPROVANTE E RASTREAMENTO
  // ═══════════════════════════════════════════════════════════
  txHash?: string;             // Hash da transação PIX/TED
  receiptUrl?: string;         // URL do comprovante
  pixKey?: string;             // Chave PIX usada (se aplicável)
  
  // ═══════════════════════════════════════════════════════════
  // 🔄 LOCK E CONCORRÊNCIA
  // ═══════════════════════════════════════════════════════════
  lockedAt?: any;              // admin.firestore.Timestamp
  lockExpiration?: any;        // admin.firestore.Timestamp
  
  // ═══════════════════════════════════════════════════════════
  // 📝 AUDITORIA
  // ═══════════════════════════════════════════════════════════
  notes?: string;
  createdAt: any;              // admin.firestore.Timestamp
  updatedAt: any;              // admin.firestore.Timestamp
}

/**
 * 🔍 RECONCILIAÇÃO DE SALDO
 * 
 * Firestore: /balanceReconciliations/{reconciliationId}
 * Execução diária automática para validar integridade
 * 
 * ÍNDICES NECESSÁRIOS (Firestore):
 * - sellerId + createdAt (DESC)
 * - sellerId + match + createdAt (DESC)
 */
export interface BalanceReconciliation {
  reconciliationId: string;
  sellerId: string;
  currency: Currency;          // Moeda reconciliada (BRL, USD, EUR)
  
  // ═══════════════════════════════════════════════════════════
  // 💰 COMPARAÇÃO: Calculado vs Armazenado (CENTAVOS)
  // ═══════════════════════════════════════════════════════════
  calculated: {
    available: number;   // CENTAVOS
    pending: number;     // CENTAVOS
    reserved: number;    // CENTAVOS
  };
  
  stored: {
    available: number;   // CENTAVOS
    pending: number;     // CENTAVOS
    reserved: number;    // CENTAVOS
  };
  
  // ═══════════════════════════════════════════════════════════
  // ✅ RESULTADO
  // ═══════════════════════════════════════════════════════════
  match: boolean;              // true se calculado === armazenado
  
  discrepancies?: {
    available?: number;        // Diferença em CENTAVOS (stored - calculated)
    pending?: number;          // CENTAVOS
    reserved?: number;         // CENTAVOS
  };
  
  // ═══════════════════════════════════════════════════════════
  // 📊 ESTATÍSTICAS DA RECONCILIAÇÃO
  // ═══════════════════════════════════════════════════════════
  ordersProcessed: number;     // Total de orders verificadas
  movementsProcessed: number;  // Total de movimentos verificados
  withdrawalsProcessed: number;
  
  executionTime: number;       // Tempo de execução (ms)
  
  // ═══════════════════════════════════════════════════════════
  // 🔧 AÇÕES TOMADAS
  // ═══════════════════════════════════════════════════════════
  autoFixed: boolean;          // Se divergência foi corrigida automaticamente
  fixDetails?: string;
  
  // ═══════════════════════════════════════════════════════════
  // 🚨 ALERTAS
  // ═══════════════════════════════════════════════════════════
  alertSent: boolean;          // Se alerta foi enviado ao admin
  alertReason?: string;
  
  // ═══════════════════════════════════════════════════════════
  // 📝 AUDITORIA
  // ═══════════════════════════════════════════════════════════
  createdAt: any;              // admin.firestore.Timestamp
  completedAt?: any;
  failedAt?: any;
  error?: string;
}

/**
 * 📊 DTO: RESUMO DE SALDO (para API responses)
 * 
 * Valores retornados em CENTAVOS - frontend converte para display
 */
export interface BalanceSummary {
  sellerId: string;
  
  // Totais por moeda (CENTAVOS)
  BRL: {
    available: number;
    pending: number;
    reserved: number;
    lifetime: number;
    withdrawn: number;
  };
  
  USD: {
    available: number;
    pending: number;
    reserved: number;
    lifetime: number;
    withdrawn: number;
  };
  
  EUR: {
    available: number;
    pending: number;
    reserved: number;
    lifetime: number;
    withdrawn: number;
  };
  
  // Breakdown por método e moeda (CENTAVOS)
  byMethod: {
    BRL: {
      pix: {
        total: number;
        byAcquirer: { [acquirer: string]: number };
      };
      creditCard: {
        total: number;
        byAcquirer: { [acquirer: string]: number };
      };
      boleto: {
        total: number;
        byAcquirer: { [acquirer: string]: number };
      };
    };
    USD: {
      creditCard: {
        total: number;
        byAcquirer: { [acquirer: string]: number };
      };
    };
  };
  
  // Breakdown por categoria e moeda (CENTAVOS)
  byCategory: {
    BRL: {
      digital: {
        total: number;
        paid: number;
        pending: number;
      };
      subscription: {
        total: number;
        paid: number;
        pending: number;
      };
    };
    USD: {
      digital: {
        total: number;
        paid: number;
        pending: number;
      };
      subscription: {
        total: number;
        paid: number;
        pending: number;
      };
    };
  };
  
  // Metadados
  lastReconciliation: any;     // admin.firestore.Timestamp | null
  lastWithdrawal: any;         // admin.firestore.Timestamp | null
  updatedAt: any;              // admin.firestore.Timestamp
}

/**
 * 🎯 FILTROS PARA CONSULTAS DE SALDO
 */
export interface BalanceFilters {
  sellerId?: string;
  method?: PaymentMethod;
  acquirer?: Acquirer;
  category?: SaleCategory;
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * 📈 VALIDAÇÃO DE SALDO (antes de saque)
 */
export interface BalanceValidation {
  valid: boolean;
  currency: Currency;
  available: number;           // CENTAVOS
  requested: number;           // CENTAVOS
  sufficient: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * 🔧 HELPER: Converter CENTAVOS para display (BRL)
 */
export function formatBRL(centavos: number): string {
  const reais = centavos / 100;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(reais);
}

/**
 * 🔧 HELPER: Converter CENTS para display (USD)
 */
export function formatUSD(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(dollars);
}

/**
 * 🔧 HELPER: Converter CENTS para display (EUR)
 */
export function formatEUR(cents: number): string {
  const euros = cents / 100;
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(euros);
}

/**
 * 🔧 HELPER: Parse BRL string para CENTAVOS
 */
export function parseBRL(valor: string): number {
  const cleaned = valor.replace(/[^\d,]/g, '').replace(',', '.');
  const reais = parseFloat(cleaned);
  return Math.round(reais * 100);
}

/**
 * 🔧 HELPER: Parse USD string para CENTS
 */
export function parseUSD(valor: string): number {
  const cleaned = valor.replace(/[^\d.]/g, '');
  const dollars = parseFloat(cleaned);
  return Math.round(dollars * 100);
}

/**
 * 🚨 ALERTA DE FRAUDE AI
 * 
 * Firestore: /fraudAlerts/{alertId}
 * Sistema de detecção de fraude com OpenAI GPT-5
 * 
 * ÍNDICES NECESSÁRIOS (Firestore):
 * - withdrawalId
 * - sellerId + reviewStatus + createdAt (DESC)
 * - riskLevel + reviewStatus + createdAt (DESC)
 * - reviewStatus + createdAt (DESC)
 */
export interface FraudAlert {
  alertId: string;
  withdrawalId: string;         // Referência ao saque analisado
  sellerId: string;
  
  // ═══════════════════════════════════════════════════════════
  // 🎯 ANÁLISE DE RISCO
  // ═══════════════════════════════════════════════════════════
  riskScore: number;            // Score 0-100 (maior = mais suspeito)
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  
  // Fatores que contribuíram para o score
  riskFactors: {
    factor: string;             // Nome do fator (ex: "multiple_withdrawals_24h")
    severity: 'low' | 'medium' | 'high';
    description: string;        // Descrição humana
    impact: number;             // Impacto no score (0-100)
  }[];
  
  // ═══════════════════════════════════════════════════════════
  // 🤖 ANÁLISE DA AI (OpenAI GPT-5)
  // ═══════════════════════════════════════════════════════════
  aiAnalysis: {
    summary: string;            // Resumo da análise
    reasoning: string;          // Raciocínio detalhado da AI
    recommendation: 'approve' | 'review_manual' | 'reject';
    confidence: number;         // Confiança da AI (0-100)
    modelUsed: string;          // Modelo OpenAI usado (gpt-5, gpt-5-mini)
    tokensUsed: number;         // Total de tokens consumidos
  };
  
  // ═══════════════════════════════════════════════════════════
  // 📊 DADOS CONTEXTUAIS DA ANÁLISE
  // ═══════════════════════════════════════════════════════════
  context: {
    withdrawalAmount: number;         // Valor do saque em CENTAVOS
    withdrawalCurrency: Currency;
    sellerBalance: number;            // Saldo disponível em CENTAVOS
    sellerLifetimeRevenue: number;    // Receita total em CENTAVOS
    sellerFirstSaleDate?: any;        // admin.firestore.Timestamp
    sellerAccountAge?: number;        // Idade da conta em dias
    
    // Histórico recente do seller
    recentWithdrawals: {
      count: number;                  // Saques nos últimos 30 dias
      totalAmount: number;            // Valor total em CENTAVOS
      averageAmount: number;          // Média em CENTAVOS
    };
    
    recentSales: {
      count: number;                  // Vendas nos últimos 30 dias
      totalRevenue: number;           // Receita em CENTAVOS
      averageTicket: number;          // Ticket médio em CENTAVOS
    };
  };
  
  // ═══════════════════════════════════════════════════════════
  // ✅ STATUS DE REVISÃO
  // ═══════════════════════════════════════════════════════════
  reviewStatus: 
    | 'unreviewed'      // Aguardando revisão humana
    | 'reviewed'        // Revisado e classificado
    | 'false_positive'  // Falso positivo (não é fraude)
    | 'confirmed_fraud' // Fraude confirmada
    | 'disputed';       // Em disputa
  
  reviewedBy?: string;          // UID do admin que revisou
  reviewedByEmail?: string;     // Email do admin
  reviewedAt?: any;             // admin.firestore.Timestamp
  reviewNotes?: string;         // Observações do admin
  
  // ═══════════════════════════════════════════════════════════
  // 🔔 NOTIFICAÇÕES
  // ═══════════════════════════════════════════════════════════
  notificationSent: boolean;    // Se admin foi notificado
  notificationSentAt?: any;     // admin.firestore.Timestamp
  
  // ═══════════════════════════════════════════════════════════
  // 🔐 AUDITORIA
  // ═══════════════════════════════════════════════════════════
  createdAt: any;               // admin.firestore.Timestamp
  updatedAt: any;               // admin.firestore.Timestamp
  
  // Versão do sistema de detecção (para tracking de melhorias)
  detectionVersion: string;     // Ex: "1.0.0"
}

// ══════════════════════════════════════════════════════════════
// 📊 MONITORING DASHBOARD - ADMIN METRICS
// ══════════════════════════════════════════════════════════════

/**
 * 💰 AGREGAÇÃO DE SALDOS POR MOEDA
 * Consolidação de todos os saldos do sistema
 */
export interface BalanceAggregation {
  currency: Currency;
  
  // Totais em CENTAVOS
  totalAvailable: number;       // Soma de todos available
  totalReserved: number;        // Soma de todos reserved (withdrawals pending)
  totalWithdrawn: number;       // Soma de todos withdrawn (lifetime)
  
  // Breakdown por seller (top 10)
  topSellers: Array<{
    sellerId: string;
    sellerEmail: string;
    available: number;
    reserved: number;
    withdrawn: number;
  }>;
  
  // Timestamp da última atualização
  lastUpdated: any;             // admin.firestore.Timestamp
}

/**
 * 🔄 MÉTRICAS DE RECONCILIAÇÃO
 * Status das reconciliações automáticas
 */
export interface ReconciliationMetrics {
  // Última execução
  lastRunAt?: any;              // admin.firestore.Timestamp
  lastRunStatus: 'success' | 'partial_success' | 'failed';
  
  // Resultados
  sellersChecked: number;
  discrepanciesFound: number;
  totalDiscrepancyAmount: number; // Em CENTAVOS (absoluto)
  
  // Maiores discrepâncias (top 5)
  topDiscrepancies: Array<{
    sellerId: string;
    sellerEmail: string;
    currency: Currency;
    storedBalance: number;      // Em CENTAVOS
    calculatedBalance: number;  // Em CENTAVOS
    difference: number;         // Em CENTAVOS (absoluto)
  }>;
  
  // Health score (0-100)
  healthScore: number;
}

/**
 * 💸 MÉTRICAS DE SAQUES
 * Estatísticas de withdrawals
 */
export interface WithdrawalMetrics {
  // Contadores gerais
  totalPending: number;
  totalApproved: number;
  totalRejected: number;
  totalCompleted: number;
  
  // Valores em CENTAVOS (por moeda)
  amountPendingBRL: number;
  amountPendingUSD: number;
  amountPendingEUR: number;
  
  amountApprovedBRL: number;
  amountApprovedUSD: number;
  amountApprovedEUR: number;
  
  // Tempo médio de aprovação (em minutos)
  averageApprovalTime: number;
  
  // Taxa de rejeição (%)
  rejectionRate: number;
  
  // Saques recentes (últimas 24h)
  recentWithdrawals: {
    count: number;
    totalAmount: number;        // Em CENTAVOS
    currency: Currency;
  };
}

/**
 * 🚨 MÉTRICAS DE FRAUDE
 * Estatísticas de fraud alerts
 */
export interface FraudMetrics {
  // Contadores gerais
  totalAlerts: number;
  totalUnreviewed: number;
  totalHighRisk: number;        // riskScore >= 70
  totalMediumRisk: number;      // riskScore 40-69
  totalLowRisk: number;         // riskScore < 40
  
  // Taxa de confirmação de fraude (%)
  fraudConfirmationRate: number;
  
  // Taxa de falsos positivos (%)
  falsePositiveRate: number;
  
  // Circuit breaker status
  circuitBreakerStatus: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  circuitBreakerFailures: number;
  
  // AI performance
  aiAvailable: boolean;
  aiAverageConfidence: number;  // 0-100
  
  // Alertas recentes (últimas 24h)
  recentAlerts: {
    count: number;
    highRiskCount: number;
  };
}

/**
 * 📈 DASHBOARD COMPLETO
 * DTO consolidado para o frontend
 */
export interface MonitoringDashboard {
  // Timestamp da geração
  generatedAt: any;             // admin.firestore.Timestamp
  
  // Métricas principais
  balances: {
    BRL: BalanceAggregation;
    USD: BalanceAggregation;
    EUR: BalanceAggregation;
  };
  
  reconciliation: ReconciliationMetrics;
  withdrawals: WithdrawalMetrics;
  fraud: FraudMetrics;
  
  // Health geral do sistema (0-100)
  systemHealth: number;
}
