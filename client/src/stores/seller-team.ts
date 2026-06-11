/**
 * Store: contexto de membro de time do seller
 * Se o usuário logado é membro de time, armazena qual seller ele representa e seu cargo
 */
import { create } from 'zustand';
import type { SellerTeamRole } from '@shared/seller-roles';

interface SellerTeamState {
  isTeamMember: boolean;
  sellerOwnerUid: string | null;
  teamRole: SellerTeamRole | null;
  memberName: string | null;
  checked: boolean;
  setTeamContext: (ctx: { sellerOwnerUid: string; teamRole: SellerTeamRole; memberName: string }) => void;
  clearTeamContext: () => void;
  setChecked: (v: boolean) => void;
}

export const useSellerTeamStore = create<SellerTeamState>((set) => ({
  isTeamMember: false,
  sellerOwnerUid: null,
  teamRole: null,
  memberName: null,
  checked: false,
  setTeamContext: ({ sellerOwnerUid, teamRole, memberName }) =>
    set({ isTeamMember: true, sellerOwnerUid, teamRole, memberName }),
  clearTeamContext: () =>
    set({ isTeamMember: false, sellerOwnerUid: null, teamRole: null, memberName: null }),
  setChecked: (v) => set({ checked: v }),
}));
