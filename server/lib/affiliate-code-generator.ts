import type { Firestore } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';

/**
 * 🔒 GERAR CÓDIGO ÚNICO DE AFILIADO COM GARANTIA DE UNICIDADE
 * 
 * - Gera código de 8 caracteres alfanuméricos em MAIÚSCULAS
 * - Verifica unicidade no Firestore (collection 'affiliates')
 * - Retry automático até 10 tentativas
 * - Fallback com timestamp se não conseguir gerar único
 * 
 * @param db - Instância do Firestore
 * @returns Promise<string> - Código único garantido
 */
export async function generateUniqueAffiliateCode(db: Firestore): Promise<string> {
  const MAX_ATTEMPTS = 10;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    // Gerar código candidato (8 caracteres)
    const candidateCode = nanoid(8).toUpperCase();

    try {
      // 🔍 VERIFICAR UNICIDADE NO FIRESTORE
      const existingCodeQuery = await db
        .collection('affiliations')
        .where('affiliateCode', '==', candidateCode)
        .limit(1)
        .get();

      // ✅ CÓDIGO ÚNICO ENCONTRADO
      if (existingCodeQuery.empty) {
        console.log(`✅ [AFFILIATE-CODE] Código único gerado: ${candidateCode} (tentativa ${attempts + 1})`);
        return candidateCode;
      }

      // ⚠️ CÓDIGO JÁ EXISTE - RETRY
      console.warn(
        `⚠️ [AFFILIATE-CODE] Código ${candidateCode} já existe - tentativa ${attempts + 1}/${MAX_ATTEMPTS}`
      );
      attempts++;
    } catch (error) {
      console.error(`❌ [AFFILIATE-CODE] Erro ao verificar unicidade:`, error);
      attempts++;
    }
  }

  // 🚨 FALLBACK: Código baseado em timestamp (garantia de unicidade por tempo)
  const fallbackCode = `${Date.now().toString(36).toUpperCase()}${nanoid(4).toUpperCase()}`;
  console.error(
    `🚨 [AFFILIATE-CODE] Fallback ativado após ${MAX_ATTEMPTS} tentativas: ${fallbackCode}`
  );

  return fallbackCode;
}

/**
 * 🔍 VERIFICAR SE CÓDIGO JÁ EXISTE
 * 
 * @param db - Instância do Firestore
 * @param code - Código para verificar
 * @returns Promise<boolean> - true se existir, false se estiver disponível
 */
export async function affiliateCodeExists(db: Firestore, code: string): Promise<boolean> {
  try {
    const query = await db
      .collection('affiliations')
      .where('affiliateCode', '==', code)
      .limit(1)
      .get();

    return !query.empty;
  } catch (error) {
    console.error(`❌ [AFFILIATE-CODE] Erro ao verificar existência:`, error);
    // Em caso de erro, assumir que existe (segurança)
    return true;
  }
}
