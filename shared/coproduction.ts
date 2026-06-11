import { z } from 'zod';

export type CoproductionStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
export type ContractDuration = 'lifetime' | 'period';
export type CommissionSource = 'own_sales' | 'affiliate_sales' | 'both';

// Zod Schemas for Validation
export const coproductionInviteSchema = z.object({
  checkoutId: z.string().min(1, 'Checkout ID é obrigatório'),
  coproducerName: z.string().min(1, 'Nome do coprodutor é obrigatório'),
  coproducerEmail: z.string().email('Email inválido'),
  commissionPercent: z.number().min(0, 'Comissão mínima: 0%').max(70, 'Comissão máxima: 70%'),
  duration: z.enum(['lifetime', 'period']),
  periodMonths: z.number().min(1).max(60).optional(),
  commissionSource: z.enum(['own_sales', 'affiliate_sales', 'both']),
  shareCustomerData: z.boolean(),
  extendCommission: z.boolean(),
});

export const coproductionContractSchema = z.object({
  id: z.string(),
  checkoutId: z.string(),
  productName: z.string(),
  sellerId: z.string(),
  sellerEmail: z.string(),
  sellerName: z.string(),
  coproducerId: z.string().nullable(),
  coproducerEmail: z.string().email(),
  coproducerName: z.string(),
  commissionPercent: z.number().min(0).max(70),
  duration: z.enum(['lifetime', 'period']),
  periodEndDate: z.date().optional().nullable(),
  commissionSource: z.enum(['own_sales', 'affiliate_sales', 'both']),
  shareCustomerData: z.boolean(),
  extendCommission: z.boolean(),
  status: z.enum(['pending', 'accepted', 'rejected', 'cancelled', 'expired']),
  invitedAt: z.date(),
  acceptedAt: z.date().optional().nullable(),
  rejectedAt: z.date().optional().nullable(),
  cancelledAt: z.date().optional().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export interface CoproductionContract {
  id: string;
  checkoutId: string;
  productName: string;
  sellerId: string;
  sellerEmail: string;
  sellerName: string;
  coproducerId: string;
  coproducerEmail: string;
  coproducerName: string;
  commissionPercent: number;
  duration: ContractDuration;
  periodEndDate?: Date;
  commissionSource: CommissionSource;
  shareCustomerData: boolean;
  extendCommission: boolean;
  status: CoproductionStatus;
  invitedAt: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CoproductionInvite {
  checkoutId: string;
  coproducerName: string;
  coproducerEmail: string;
  commissionPercent: number;
  duration: ContractDuration;
  periodMonths?: number;
  commissionSource: CommissionSource;
  shareCustomerData: boolean;
  extendCommission: boolean;
}

export interface CoproductionCommission {
  id: string;
  contractId: string;
  orderId: string;
  checkoutId: string;
  sellerId: string;
  coproducerId: string;
  orderAmount: number;
  commissionPercent: number;
  commissionAmount: number;
  source: 'own_sale' | 'affiliate_sale';
  affiliateId?: string;
  status: 'pending' | 'paid' | 'cancelled';
  createdAt: Date;
  paidAt?: Date;
}

export interface CoproducerSummary {
  totalContracts: number;
  activeContracts: number;
  pendingInvites: number;
  totalCommissionPercent: number;
  availablePercent: number;
  totalEarnings: number;
  monthlyEarnings: number;
}
