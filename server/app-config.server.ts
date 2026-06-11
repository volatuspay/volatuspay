/**
 * CONFIGURAÇÃO SERVIDOR-ONLY ZEN PAGAMENTOS
 * 
 * Configurações sensíveis que devem estar APENAS no servidor.
 * NUNCA importar no cliente - dados sensíveis!
 */

// ⚠️ DADOS CONHECIDOS DE USUÁRIOS PARA SINCRONIZAÇÃO (SERVIDOR APENAS)
// 🔐 SEGURANÇA: UIDs removidos para evitar exposição
// Use Firebase Admin SDK para verificar admin via Custom Claims
// 🏷️ WHITELABEL: Configure ADMIN_EMAIL env var para definir o admin principal
const adminEmail = process.env.ADMIN_EMAIL || 'jr4813678@gmail.com';
export const KNOWN_USERS = [
  { email: adminEmail, status: 'approved', businessName: 'Platform Admin', admin: true },
] as const;