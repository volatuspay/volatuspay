// 🛡️ SISTEMA DE SEGURANÇA COMPLETO - EXPORTAÇÕES PRINCIPAIS
// Centralizador de todos os módulos de segurança

export {
  criticalOperationMiddleware,
  generateSecureToken,
  validateSecureToken,
  addSuspiciousIP,
} from './anti-cheat';

export {
  ddosProtectionMiddleware,
  getSecurityStats,
  updateRateLimit,
  blockIP,
  unblockIP
} from './ddos-protection';

export {
  detectFraud,
  provideFraudFeedback,
  getFraudStats
} from './ai-fraud-detection';

export {
  isValidCPF,
  validateRealCPF,
  detectFraud as detectCPFFraud,
  isSuspiciousName
} from './cpf-validator';

export {
  verifyFirebaseToken,
  requireAdmin,
  authStatusHandler
} from './firebase-auth';

export type { AuthUser, AuthenticatedRequest } from './firebase-auth';