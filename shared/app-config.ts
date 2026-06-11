/**
 * CONFIGURAÇÃO COMPARTILHADA ZEN PAGAMENTOS
 * 
 * Configurações centralizadas que podem ser usadas tanto no cliente quanto no servidor.
 * Esta é a fonte única da verdade para configurações admin e dados conhecidos.
 */

// 🔐 CONFIGURAÇÃO ADMIN CENTRALIZADA (VIA CUSTOM CLAIMS - SEGURO)
// NUNCA verificar admin por UID hardcoded - usar Firebase Custom Claims
export const ADMIN_CONFIG = {
  // ⚠️ REMOVIDO: UIDs hardcoded por segurança
  // Use Custom Claims no backend: req.user.isAdmin || req.authUser.isAdmin
  BASE_AUTHORIZED_UIDS: [] as string[],
  
  // ⚠️ DEPRECATED: Use Custom Claims no backend
  getAuthorizedUids: (): string[] => {
    console.warn('⚠️ ADMIN_CONFIG.getAuthorizedUids() está deprecated - Use Firebase Custom Claims');
    return [];
  },
  
  // ⚠️ DEPRECATED: Use Custom Claims no backend
  isAuthorizedAdmin: (uid: string): boolean => {
    console.warn('⚠️ ADMIN_CONFIG.isAuthorizedAdmin() está deprecated - Use Firebase Custom Claims');
    return false;
  }
} as const;