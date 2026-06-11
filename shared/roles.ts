/**
 * 🔐 SISTEMA DE CARGOS E PERMISSÕES ZEN PAGAMENTOS
 * Sistema completo de roles e permissions para gestão de equipe
 */

// 🎭 CARGOS DISPONÍVEIS (em ordem hierárquica)
export const ROLES = {
  CEO_FOUNDER: 'ceo_founder',
  ADMIN: 'admin',
  MANAGER: 'manager',
  FINANCIAL: 'financial',
  DEVELOPER: 'developer',
  MODERATOR: 'moderator',
  SUPPORT: 'support',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

// 🏷️ LABELS DOS CARGOS
export const ROLE_LABELS: Record<Role, string> = {
  [ROLES.CEO_FOUNDER]: 'CEO Fundador',
  [ROLES.ADMIN]: 'Admin',
  [ROLES.MANAGER]: 'Gerente',
  [ROLES.FINANCIAL]: 'Financeiro',
  [ROLES.DEVELOPER]: 'Desenvolvedor',
  [ROLES.MODERATOR]: 'Moderador',
  [ROLES.SUPPORT]: 'Suporte',
};

// 🎨 CORES DOS CARGOS (para badges)
export const ROLE_COLORS: Record<Role, string> = {
  [ROLES.CEO_FOUNDER]: 'bg-purple-500 text-white',
  [ROLES.ADMIN]: 'bg-red-500 text-white',
  [ROLES.MANAGER]: 'bg-blue-500 text-white',
  [ROLES.FINANCIAL]: 'bg-green-500 text-white',
  [ROLES.DEVELOPER]: 'bg-indigo-500 text-white',
  [ROLES.MODERATOR]: 'bg-yellow-500 text-black',
  [ROLES.SUPPORT]: 'bg-gray-500 text-white',
};

// 🔐 CEO FUNDADOR — identificado via Firebase Custom Claims no backend (não exposto no frontend)
export const CEO_FOUNDER_EMAIL = (typeof process !== 'undefined' ? process.env?.ADMIN_EMAIL : undefined) || '';

// 📋 PERMISSÕES DISPONÍVEIS
export const PERMISSIONS = {
  // Central de Atendimento
  VIEW_SUPPORT: 'view_support',
  MANAGE_SUPPORT: 'manage_support',
  
  // Dashboard
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_ANALYTICS: 'view_analytics',
  
  // Financeiro
  VIEW_TRANSACTIONS: 'view_transactions',
  APPROVE_WITHDRAWALS: 'approve_withdrawals',
  REFUND_WITHDRAWALS: 'refund_withdrawals',
  
  // Sellers
  VIEW_SELLERS: 'view_sellers',
  APPROVE_SELLERS: 'approve_sellers',
  MANAGE_SELLERS: 'manage_sellers',
  VIEW_RISK_SELLERS: 'view_risk_sellers',
  
  // Produtos
  VIEW_PRODUCTS: 'view_products',
  MANAGE_PRODUCTS: 'manage_products',
  
  // Configurações
  MANAGE_BANNERS: 'manage_banners',
  MANAGE_ACQUIRERS: 'manage_acquirers',
  RESET_ACCOUNTS: 'reset_accounts',
  MANAGE_CONFIGS: 'manage_configs',
  
  // Segurança
  VIEW_SECURITY: 'view_security',
  MANAGE_SECURITY: 'manage_security',
  
  // Premiações
  MANAGE_ACHIEVEMENTS: 'manage_achievements',
  
  // Equipe (apenas CEO Fundador)
  MANAGE_TEAM: 'manage_team',
  MANAGE_ROLES: 'manage_roles',
  MANAGE_PERMISSIONS: 'manage_permissions',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// 🎯 PERMISSÕES POR CARGO (padrão)
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [ROLES.CEO_FOUNDER]: Object.values(PERMISSIONS), // Todas as permissões
  
  [ROLES.ADMIN]: [
    PERMISSIONS.VIEW_SUPPORT,
    PERMISSIONS.MANAGE_SUPPORT,
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.VIEW_TRANSACTIONS,
    PERMISSIONS.APPROVE_WITHDRAWALS,
    PERMISSIONS.REFUND_WITHDRAWALS,
    PERMISSIONS.VIEW_SELLERS,
    PERMISSIONS.APPROVE_SELLERS,
    PERMISSIONS.MANAGE_SELLERS,
    PERMISSIONS.VIEW_RISK_SELLERS,
    PERMISSIONS.VIEW_PRODUCTS,
    PERMISSIONS.MANAGE_PRODUCTS,
    PERMISSIONS.MANAGE_BANNERS,
    PERMISSIONS.MANAGE_ACQUIRERS,
    PERMISSIONS.RESET_ACCOUNTS,
    PERMISSIONS.MANAGE_CONFIGS,
    PERMISSIONS.VIEW_SECURITY,
    PERMISSIONS.MANAGE_SECURITY,
    PERMISSIONS.MANAGE_ACHIEVEMENTS,
  ],
  
  [ROLES.MANAGER]: [
    PERMISSIONS.VIEW_SUPPORT,
    PERMISSIONS.MANAGE_SUPPORT,
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.VIEW_TRANSACTIONS,
    PERMISSIONS.APPROVE_WITHDRAWALS,
    PERMISSIONS.VIEW_SELLERS,
    PERMISSIONS.APPROVE_SELLERS,
    PERMISSIONS.MANAGE_SELLERS,
    PERMISSIONS.VIEW_PRODUCTS,
    PERMISSIONS.MANAGE_PRODUCTS,
  ],
  
  [ROLES.FINANCIAL]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_TRANSACTIONS,
    PERMISSIONS.APPROVE_WITHDRAWALS,
    PERMISSIONS.REFUND_WITHDRAWALS,
  ],
  
  [ROLES.DEVELOPER]: [
    PERMISSIONS.VIEW_SUPPORT,
    PERMISSIONS.MANAGE_SUPPORT,
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.VIEW_TRANSACTIONS,
    PERMISSIONS.APPROVE_WITHDRAWALS,
    PERMISSIONS.REFUND_WITHDRAWALS,
    PERMISSIONS.VIEW_SELLERS,
    PERMISSIONS.APPROVE_SELLERS,
    PERMISSIONS.MANAGE_SELLERS,
    PERMISSIONS.VIEW_RISK_SELLERS,
    PERMISSIONS.VIEW_PRODUCTS,
    PERMISSIONS.MANAGE_PRODUCTS,
    PERMISSIONS.MANAGE_BANNERS,
    PERMISSIONS.MANAGE_ACQUIRERS,
    PERMISSIONS.RESET_ACCOUNTS,
    PERMISSIONS.MANAGE_CONFIGS,
    PERMISSIONS.VIEW_SECURITY,
    PERMISSIONS.MANAGE_SECURITY,
    PERMISSIONS.MANAGE_ACHIEVEMENTS,
  ],
  
  [ROLES.MODERATOR]: [
    PERMISSIONS.VIEW_SUPPORT,
    PERMISSIONS.MANAGE_SUPPORT,
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_SELLERS,
    PERMISSIONS.VIEW_PRODUCTS,
  ],
  
  [ROLES.SUPPORT]: [
    PERMISSIONS.VIEW_SUPPORT,
    PERMISSIONS.MANAGE_SUPPORT,
  ],
};

// 🔍 HELPER: Verificar se email é CEO Fundador
export function isCEOFounder(email: string | undefined): boolean {
  return email === CEO_FOUNDER_EMAIL;
}

// 🔍 HELPER: Verificar se usuário tem permissão
export function hasPermission(userPermissions: Permission[], permission: Permission): boolean {
  return userPermissions.includes(permission);
}

// 🔍 HELPER: Obter permissões de um cargo
export function getRolePermissions(role: Role): Permission[] {
  return DEFAULT_ROLE_PERMISSIONS[role] || [];
}
