import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Tenant } from '@shared/schema';

interface TenantState {
  tenant: Tenant | null;
  loading: boolean;
  setTenant: (tenant: Tenant | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useTenantStore = create<TenantState>()(
  subscribeWithSelector((set) => ({
    tenant: null,
    loading: true,
    setTenant: (tenant) => set({ tenant }),
    setLoading: (loading) => set({ loading }),
  }))
);
