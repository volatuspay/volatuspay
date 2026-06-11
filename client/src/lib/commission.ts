import type { PlatformFees } from '@/hooks/use-platform-fees';

export interface CommissionCalculationInput {
  offerPriceCents: number;
  commissionPercent: number;
  paymentMethod: 'pix' | 'creditCard' | 'boleto' | 'global';
  platformFees: PlatformFees;
}

export interface CommissionCalculationResult {
  grossCommission: number;
  platformFeeAmount: number;
  netCommission: number;
  releaseDays: number;
  formatted: string;
}

export function calculateAffiliateCommission(input: CommissionCalculationInput): CommissionCalculationResult {
  const { offerPriceCents, commissionPercent, paymentMethod, platformFees } = input;

  if (offerPriceCents <= 0 || commissionPercent <= 0) {
    return {
      grossCommission: 0,
      platformFeeAmount: 0,
      netCommission: 0,
      releaseDays: 30,
      formatted: 'R$ 0,00',
    };
  }

  const safeNum = (val: any): number => {
    const num = Number(val);
    return isNaN(num) || !isFinite(num) ? 0 : num;
  };

  const grossCommissionCents = (offerPriceCents * commissionPercent) / 100;

  let fixedFeeCents = 0;
  let percentFee = 0;
  let releaseDays = 30;

  switch (paymentMethod) {
    case 'pix':
      fixedFeeCents = safeNum(platformFees.pixFixedFee);
      percentFee = safeNum(platformFees.pixPercentFee);
      releaseDays = safeNum(platformFees.pixReleaseDays) || 30;
      break;
    case 'creditCard':
      fixedFeeCents = safeNum(platformFees.creditCardBRFixedFee);
      percentFee = safeNum(platformFees.creditCardBRPercentFee);
      releaseDays = safeNum(platformFees.creditCardBRReleaseDays) || 30;
      break;
    case 'boleto':
      fixedFeeCents = safeNum(platformFees.boletoFixedFee);
      percentFee = safeNum(platformFees.boletoPercentFee);
      releaseDays = safeNum(platformFees.boletoReleaseDays) || 30;
      break;
    default:
      fixedFeeCents = safeNum(platformFees.globalFixedFee);
      percentFee = safeNum(platformFees.globalPercentFee);
      releaseDays = safeNum(platformFees.globalReleaseDays) || 30;
  }

  const platformFeeAmountCents = fixedFeeCents + (grossCommissionCents * percentFee / 100);
  const netCommissionCents = Math.max(0, grossCommissionCents - platformFeeAmountCents);

  const formatted = `R$ ${(netCommissionCents / 100).toFixed(2).replace('.', ',')}`;

  return {
    grossCommission: Math.round(grossCommissionCents),
    platformFeeAmount: Math.round(platformFeeAmountCents),
    netCommission: Math.round(netCommissionCents),
    releaseDays: Math.round(releaseDays),
    formatted,
  };
}
