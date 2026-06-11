/**
 * 🔐 VALIDADOR DE ENVIRONMENT VARIABLES
 * Sistema robusto para garantir que todas as credenciais estão configuradas
 */

interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
  summary: string;
}

/**
 * ✅ ENV VARS CRÍTICAS (OBRIGATÓRIAS)
 * Sistema não inicia sem estas variáveis
 * Nota: Para Firebase, aceita múltiplas formas de credenciais (validado separadamente)
 * IMPORTANTE: VITE_* são variáveis do FRONTEND e são validadas no cliente, não no servidor
 */
const CRITICAL_ENV_VARS = [
  'FIREBASE_CREDENTIALS' // Placeholder - validado por lógica customizada
] as const;

/**
 * ⚠️ ENV VARS OPCIONAIS (RECOMENDADAS)
 * Sistema funciona sem estas, mas com funcionalidade limitada
 */
const OPTIONAL_ENV_VARS = [
  'OPENAI_API_KEY'
] as const;

/**
 * 🔍 VALIDAR TODAS AS ENV VARS
 * Retorna relatório completo de validação
 */
export function validateEnvironmentVariables(): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  // ✅ Verificar variáveis críticas
  for (const envVar of CRITICAL_ENV_VARS) {
    // 🔥 FIREBASE CREDENTIALS: Aceitar MÚLTIPLAS formas
    if (envVar === 'FIREBASE_CREDENTIALS') {
      const hasServiceAccount = !!(process.env.FIREBASE_SERVICE_ACCOUNT?.trim());
      const hasJson = !!(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
      const hasJsonZenpagamentos = !!(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_ZENPAGAMENTOS?.trim());
      const hasJsonB64 = !!(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64?.trim());
      const hasIndividual = !!(
        process.env.FIREBASE_PROJECT_ID?.trim() &&
        process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
        process.env.FIREBASE_PRIVATE_KEY?.trim()
      );
      
      if (!hasServiceAccount && !hasJson && !hasJsonZenpagamentos && !hasJsonB64 && !hasIndividual) {
        missing.push('Firebase credentials (FIREBASE_SERVICE_ACCOUNT ou _JSON ou _ZENPAGAMENTOS ou _B64 ou credenciais individuais)');
      }
      continue;
    }
    
    const value = process.env[envVar];
    if (!value || value.trim() === '') {
      missing.push(envVar);
    }
  }

  // ⚠️ Verificar variáveis opcionais
  for (const envVar of OPTIONAL_ENV_VARS) {
    const value = process.env[envVar];
    if (!value || value.trim() === '') {
      warnings.push(envVar);
    }
  }

  // 📊 Gerar relatório
  const valid = missing.length === 0;
  const summary = valid
    ? `✅ Todas as ${CRITICAL_ENV_VARS.length} variáveis críticas configuradas`
    : `🚨 ${missing.length} variáveis críticas faltando`;

  return {
    valid,
    missing,
    warnings,
    summary
  };
}

/**
 * 🚨 VALIDAR E LANÇAR ERRO SE INVÁLIDO (PRODUÇÃO) OU AVISAR (DEV)
 * Usa em startup para garantir sistema não inicia sem credenciais em produção
 * Em produção, faz retry para aguardar injeção de secrets pelo runtime
 */
export async function validateOrThrow(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.REPLIT_DEPLOYMENT;
  const skipValidation = process.env.SKIP_ENV_VALIDATION === 'true';

  if (skipValidation) {
    console.warn('⚠️⚠️⚠️ SKIP_ENV_VALIDATION ATIVO - Validação desabilitada! ⚠️⚠️⚠️');
    console.warn('🔧 Apenas para emergências - remova esta flag em produção!');
    return;
  }

  const maxAttempts = isProduction ? 5 : 1;
  let lastResult: EnvValidationResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = validateEnvironmentVariables();

    if (lastResult.valid) {
      break;
    }

    if (attempt < maxAttempts) {
      const delay = Math.min(1000 * attempt, 3000);
      console.log(`🔄 [ENV-VALIDATOR] Tentativa ${attempt}/${maxAttempts} - Aguardando ${delay}ms para secrets serem injetados...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  const result = lastResult!;

  if (!result.valid) {
    const message = `Sistema sem ${result.missing.length} variáveis críticas: ${result.missing.join(', ')}`;
    
    if (isProduction) {
      console.error('🚨 ERRO CRÍTICO DE PRODUÇÃO: Environment variables faltando!');
      console.error('❌ Variáveis críticas não configuradas:');
      result.missing.forEach(envVar => {
        console.error(`   - ${envVar}`);
      });
      console.error('\n📝 Configure estas variáveis nos Replit Secrets antes de fazer deploy.');
      
      throw new Error(message);
    }
    
    console.warn('⚠️ AVISO: Environment variables faltando (modo desenvolvimento)');
    console.warn('❌ Variáveis críticas não configuradas:');
    result.missing.forEach(envVar => {
      console.warn(`   - ${envVar}`);
    });
    console.warn('💡 Em produção, isso bloquearia o boot. Configure antes do deploy.');
  } else {
    console.log(result.summary);
  }

  if (result.warnings.length > 0) {
    console.warn(`⚠️ ${result.warnings.length} variáveis opcionais não configuradas:`);
    result.warnings.forEach(envVar => {
      console.warn(`   - ${envVar} (funcionalidade limitada)`);
    });
  }
}

/**
 * 📋 LISTAR ENV VARS CONFIGURADAS (sem expor valores)
 * Útil para debugging e auditoria
 */
export function listConfiguredEnvVars(): {
  critical: { name: string; configured: boolean }[];
  optional: { name: string; configured: boolean }[];
} {
  const critical = CRITICAL_ENV_VARS.map(name => ({
    name,
    configured: !!(process.env[name]?.trim())
  }));

  const optional = OPTIONAL_ENV_VARS.map(name => ({
    name,
    configured: !!(process.env[name]?.trim())
  }));

  return { critical, optional };
}
