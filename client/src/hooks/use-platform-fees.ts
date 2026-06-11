import { useQuery } from '@tanstack/react-query';

export interface PlatformFees {
  pixFixedFee: number;
  pixPercentFee: number;
  pixReleaseDays: number;
  creditCardBRFixedFee: number;
  creditCardBRPercentFee: number;
  creditCardBRReleaseDays: number;
  boletoFixedFee: number;
  boletoPercentFee: number;
  boletoReleaseDays: number;
  globalFixedFee: number;
  globalPercentFee: number;
  globalReleaseDays: number;
}

export function usePlatformFees() {
  return useQuery<PlatformFees>({
    queryKey: ['/api/public/platform-fees'],
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 3,
  });
}
