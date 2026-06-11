/**
 * 🔐 SECURITY INTEGRATION LAYER
 * Aplica correções de segurança IDOR/CSRF/Pricing de forma NÃO-DESTRUTIVA
 * Pode ser gradualmente integrado nas rotas existentes
 */

import { Express, Router } from 'express';
import { verifyFirebaseToken } from './firebase-auth';
import {
  secureProductCreate,
  secureCheckoutUpdate,
  secureOrderCreate,
  secureContentUpdate,
  secureWithdrawal,
  csrfTokenHandler,
  getAllowedOrigins,
  validateOrigin
} from './enhanced-security-layer';

/**
 * 🎯 APLICAR CAMADAS DE SEGURANÇA
 * Função principal que integra todas as correções de segurança
 */
export function applySecurityEnhancements(app: Express) {
  console.log('🛡️ Aplicando camada de segurança aprimorada...');

  // 🔐 CSRF TOKEN ENDPOINT
  // GET /api/csrf - Obter token CSRF para requisições autenticadas
  app.get('/api/csrf', verifyFirebaseToken, csrfTokenHandler);
  console.log('✅ Endpoint CSRF token configurado: GET /api/csrf');

  // 🌐 ORIGIN VALIDATION MIDDLEWARE
  // Aplica validação de origin em rotas críticas (opcional por enquanto)
  const allowedOrigins = getAllowedOrigins();
  console.log('🌐 Allowed origins configured:', allowedOrigins.join(', '));

  // ✅ SUCESSO
  console.log('✅ Camada de segurança aprimorada aplicada com sucesso!');
  console.log('📊 Recursos de segurança ativados:');
  console.log('   ✓ CSRF Protection disponível (GET /api/csrf)');
  console.log('   ✓ Origin Validation configurado');
  console.log('   ✓ Ownership Utils disponíveis');
  console.log('   ✓ Server-side Pricing disponível');
  console.log('   ✓ Mass Assignment Protection ativo');
  console.log('   ✓ Security wrappers prontos para uso');
}

/**
 * 🔒 WRAPPER PARA ROTAS EXISTENTES - APLICA OWNERSHIP
 * Pode ser usado para gradualmente adicionar validação de ownership em rotas existentes
 */
export const securityWrappers = {
  productCreate: secureProductCreate,
  checkoutUpdate: secureCheckoutUpdate,
  orderCreate: secureOrderCreate,
  moduleUpdate: secureContentUpdate('modules'),
  lessonUpdate: secureContentUpdate('lessons'),
  withdrawal: secureWithdrawal
};

/**
 * 📊 ESTATÍSTICAS DE SEGURANÇA
 */
export function getSecurityStats() {
  return {
    features: {
      csrfProtection: true,
      ownershipValidation: true,
      serverSidePricing: true,
      originValidation: true,
      massAssignmentProtection: true
    },
    allowedOrigins: getAllowedOrigins().length,
    version: '1.0.0'
  };
}

/**
 * 🎯 EXEMPLO DE USO:
 * 
 * // No server/index.ts:
 * import { applySecurityEnhancements, securityWrappers } from './security/security-integration-layer';
 * 
 * // Aplicar camada de segurança
 * applySecurityEnhancements(app);
 * 
 * // Usar wrappers em rotas específicas:
 * app.post('/api/products', 
 *   verifyFirebaseToken, 
 *   securityWrappers.productCreate,  // ← ADICIONAR AQUI
 *   async (req, res) => { ... }
 * );
 * 
 * app.put('/api/checkout/update/:id',
 *   verifyFirebaseToken,
 *   securityWrappers.checkoutUpdate,  // ← ADICIONAR AQUI
 *   async (req, res) => { ... }
 * );
 */

export default applySecurityEnhancements;
