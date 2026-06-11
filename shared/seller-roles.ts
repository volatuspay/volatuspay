/**
 * SISTEMA DE TIME DO SELLER
 * Cargos e permissões para equipe interna do seller
 * Separado do sistema de admin
 */

export const SELLER_TEAM_ROLES = {
  VENDAS: 'vendas',
  FINANCEIRO: 'financeiro',
  PRODUTOS: 'produtos',
} as const;

export type SellerTeamRole = typeof SELLER_TEAM_ROLES[keyof typeof SELLER_TEAM_ROLES];

export const SELLER_TEAM_ROLE_LABELS: Record<SellerTeamRole, string> = {
  [SELLER_TEAM_ROLES.VENDAS]: 'Vendas',
  [SELLER_TEAM_ROLES.FINANCEIRO]: 'Financeiro',
  [SELLER_TEAM_ROLES.PRODUTOS]: 'Produtos',
};

export const SELLER_TEAM_ROLE_DESCRIPTIONS: Record<SellerTeamRole, string> = {
  [SELLER_TEAM_ROLES.VENDAS]: 'Acessa Vendas e Assinaturas',
  [SELLER_TEAM_ROLES.FINANCEIRO]: 'Acessa Financeiro e pode solicitar saque',
  [SELLER_TEAM_ROLES.PRODUTOS]: 'Acessa Produtos e Vitrine',
};

// Quais títulos de menu cada role pode ver (sidebar)
export const SELLER_TEAM_ALLOWED_MENUS: Record<SellerTeamRole, string[]> = {
  [SELLER_TEAM_ROLES.VENDAS]: ['Dashboard', 'Volatus AI', 'Vendas', 'Assinaturas'],
  [SELLER_TEAM_ROLES.FINANCEIRO]: ['Dashboard', 'Volatus AI', 'Financeiro', 'Saque em Cripto'],
  [SELLER_TEAM_ROLES.PRODUTOS]: ['Dashboard', 'Volatus AI', 'Vitrine', 'Produtos'],
};

export const MAX_SELLER_TEAM_MEMBERS = 5;

export interface SellerTeamMember {
  id: string;
  sellerUid: string;
  memberUid: string;
  email: string;
  name: string;
  role: SellerTeamRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
