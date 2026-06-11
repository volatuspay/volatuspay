import admin from 'firebase-admin';
import type { PaymentConfig } from '../../shared/schema.js';
import { encryptSensitiveData, decryptSensitiveData } from '../security/key-encryption.js';
import { loadEternalCredentials, loadEternalFees } from './eternal-credentials.js';
import { syncAllAcquirersToRTDB, syncGlobalFeesToRTDB, syncWithdrawalConfigToRTDB, syncAllCredentialsToRTDB, loadCredentialsFromRTDB } from './eternal-sync.js';
import { firestoreCache } from './firestore-cache.js';

// 🔐 HELPER: BUSCAR CONFIGURAÇÕES DE PAGAMENTO DO FIREBASE
// Fallback para environment variables se não configurado no banco
export async function getPaymentConfig(db: admin.firestore.Firestore): Promise<PaymentConfig | null> {
  try {
    try {
      const cached = firestoreCache.getPaymentConfigFromCache('global');
      if (cached !== undefined) {
        console.log('✅ [CACHE] PaymentConfig servido do cache');
        return cached;
      }
    } catch (e) {}
    
    console.log('🔍 Buscando configurações de pagamento do Firebase...');
    console.log('📍 Coleção: paymentConfig, Documento: global');
    
    const configDoc = await db.collection('paymentConfig').doc('global').get();
    
    console.log(`📊 Documento existe? ${configDoc.exists}`);
    
    if (!configDoc.exists) {
      console.log('⚠️ Configurações de pagamento não encontradas no Firebase - usando fallback do environment');
      return null;
    }
    
    const data = configDoc.data() as any;
    console.log('📦 Dados do Firebase carregados (paymentConfig/global)');
    
    // 🔓 DESCRIPTOGRAFAR CHAVES SENSÍVEIS COM BACKWARD COMPATIBILITY
    const safeDecrypt = (value: string | undefined, keyName: string = 'chave'): string | undefined => {
      if (!value) return undefined;
      
      // Verificar se está no formato correto de criptografia (IV:AuthTag:Encrypted)
      if (!value.includes(':') || value.split(':').length !== 3) {
        console.warn(`⚠️ ${keyName} está em formato plain-text (não criptografada)`);
        console.warn(`⚠️ RECOMENDAÇÃO: Salve novamente no painel admin para criptografar`);
        // ✅ BACKWARD COMPATIBILITY: Retorna valor plain-text para não quebrar
        return value;
      }
      
      try {
        let decrypted = decryptSensitiveData(value);
        console.log(`✅ ${keyName} descriptografada (1ª tentativa) com sucesso (${decrypted.length} chars)`);
        
        // 🔧 FIX: Verificar se ainda está criptografada (dupla-criptografia)
        // Se resultado ainda tem formato IV:AuthTag:Encrypted, descriptografar de novo
        if (decrypted.includes(':') && decrypted.split(':').length === 3) {
          console.log(`🔄 ${keyName} ainda está criptografada! Descriptografando novamente...`);
          try {
            decrypted = decryptSensitiveData(decrypted);
            console.log(`✅ ${keyName} descriptografada (2ª tentativa) com sucesso (${decrypted.length} chars)`);
          } catch (error2) {
            console.warn(`⚠️ 2ª descriptografia falhou - usando resultado da 1ª tentativa`);
            // Usa o resultado da primeira descriptografia
          }
        }
        
        return decrypted;
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Erro ao descriptografar ${keyName}:`, errorMessage);
        console.error(`📍 Provavelmente a ENCRYPTION_MASTER_KEY mudou desde que ${keyName} foi salva`);
        console.warn(`⚠️ FALLBACK: Usando valor original para ${keyName}`);
        console.warn(`⚠️ SOLUÇÃO: Re-salve ${keyName} no painel admin para re-criptografar com master key atual`);
        // ✅ FALLBACK: Retorna valor original se descriptografia falhar
        return value;
      }
    };
    
    // 🔄 MIGRAÇÃO AUTOMÁTICA: Converter estrutura antiga para nova
    let defaultAcquirers: any = data.defaultAcquirers || {
      pix: 'woovi',
      creditCardBR: 'efibank',
      creditCardGlobal: 'stripe',
      boleto: 'woovi',
    };
    
    // Se ainda tem estrutura antiga (creditCard), migrar para nova
    if ('creditCard' in defaultAcquirers && !('creditCardBR' in defaultAcquirers)) {
      const legacyValue = defaultAcquirers.creditCard;
      
      // GATEWAYS INTERNACIONAIS (processam em USD/EUR)
      if (legacyValue === 'stripe' || legacyValue === 'adyen') {
        defaultAcquirers.creditCardGlobal = legacyValue;
        defaultAcquirers.creditCardBR = 'efibank'; // Fallback brasileiro
      }
      // GATEWAYS BRASILEIROS (processam em BRL)
      else if (legacyValue === 'efibank' || legacyValue === 'pagarme') {
        defaultAcquirers.creditCardBR = legacyValue;
        defaultAcquirers.creditCardGlobal = 'stripe'; // Fallback internacional
      }
      // FALLBACK GENÉRICO
      else {
        defaultAcquirers.creditCardBR = 'efibank';
        defaultAcquirers.creditCardGlobal = 'stripe';
      }
      delete defaultAcquirers.creditCard;
    }

    // 🌟 CARREGAR TAXAS ETERNAS (NUNCA PERDE)
    const eternalFees = await loadEternalFees(db);
    
    const config: PaymentConfig = {
      id: data.id || 'global',
      defaultAcquirers,
      fees: data.fees ? {
        ...data.fees,
        // 🔄 MIGRAÇÃO: Se tem estrutura antiga, criar campos novos usando taxas eternas como fallback
        creditCardBRFixedFee: data.fees.creditCardBRFixedFee ?? data.fees.creditCardFixedFee ?? eternalFees.creditCardBRFixedFee,
        creditCardBRPercentFee: data.fees.creditCardBRPercentFee ?? data.fees.creditCardPercentFee ?? eternalFees.creditCardBRPercentFee,
        creditCardBRReleaseDays: data.fees.creditCardBRReleaseDays ?? data.fees.creditCardReleaseDays ?? eternalFees.creditCardBRReleaseDays,
        creditCardGlobalFixedFee: data.fees.creditCardGlobalFixedFee ?? data.fees.creditCardFixedFee ?? eternalFees.creditCardGlobalFixedFee,
        creditCardGlobalPercentFee: data.fees.creditCardGlobalPercentFee ?? data.fees.creditCardPercentFee ?? eternalFees.creditCardGlobalPercentFee,
        creditCardGlobalReleaseDays: data.fees.creditCardGlobalReleaseDays ?? data.fees.creditCardReleaseDays ?? eternalFees.creditCardGlobalReleaseDays,
      } : eternalFees,
      stripe: await (async () => {
        let stripeConfig: any = {
          enabled: data.stripe?.enabled ?? true,
          environment: data.stripe?.environment || 'test',
          publicKey: data.stripe?.publicKey,
          secretKey: (data.stripe?.enabled ?? true) ? safeDecrypt(data.stripe?.secretKey, 'Stripe Secret Key') : undefined,
          webhookSecret: (data.stripe?.enabled ?? true) ? safeDecrypt(data.stripe?.webhookSecret, 'Stripe Webhook Secret') : undefined,
        };
        if (stripeConfig.enabled && !stripeConfig.secretKey) {
          try {
            const rtdbStripe = await loadCredentialsFromRTDB('stripe');
            if (rtdbStripe?.secretKey) {
              console.log('🔄 [RTDB-FALLBACK] Carregando Stripe do RTDB (Firestore falhou ou vazio)...');
              stripeConfig.secretKey = safeDecrypt(rtdbStripe.secretKey, 'Stripe RTDB Secret');
              stripeConfig.webhookSecret = stripeConfig.webhookSecret || safeDecrypt(rtdbStripe.webhookSecret, 'Stripe RTDB Webhook');
              stripeConfig.publicKey = stripeConfig.publicKey || rtdbStripe.publicKey;
            }
          } catch (e) { console.warn('⚠️ RTDB fallback Stripe falhou'); }
        }
        return stripeConfig;
      })(),
      efibank: await loadEternalCredentials(db),
      adyen: await (async () => {
        let adyenConfig: any = {
          enabled: data.adyen?.enabled ?? false,
          environment: data.adyen?.environment || 'test',
          apiKey: data.adyen?.enabled ? safeDecrypt(data.adyen?.apiKey, 'Adyen API Key') : undefined,
          merchantAccount: data.adyen?.merchantAccount || '',
          clientKey: data.adyen?.clientKey || '',
        };
        if (adyenConfig.enabled && !adyenConfig.apiKey) {
          try {
            const rtdbAdyen = await loadCredentialsFromRTDB('adyen');
            if (rtdbAdyen?.apiKey) {
              console.log('🔄 [RTDB-FALLBACK] Carregando Adyen do RTDB...');
              adyenConfig.apiKey = safeDecrypt(rtdbAdyen.apiKey, 'Adyen RTDB API Key');
              adyenConfig.merchantAccount = adyenConfig.merchantAccount || rtdbAdyen.merchantAccount || '';
              adyenConfig.clientKey = adyenConfig.clientKey || rtdbAdyen.clientKey || '';
            }
          } catch (e) { console.warn('⚠️ RTDB fallback Adyen falhou'); }
        }
        return adyenConfig;
      })(),
      woovi: await (async () => {
        let wooviConfig: any = {
          enabled: data.woovi?.enabled === true,
          environment: data.woovi?.environment || 'sandbox',
          appId: data.woovi?.enabled ? safeDecrypt(data.woovi?.appId, 'Woovi App ID') : undefined,
          webhookSecret: data.woovi?.enabled ? safeDecrypt(data.woovi?.webhookSecret, 'Woovi Webhook Secret') : undefined,
        };
        if (wooviConfig.enabled && !wooviConfig.appId) {
          try {
            const rtdbWoovi = await loadCredentialsFromRTDB('woovi');
            if (rtdbWoovi?.appId) {
              console.log('🔄 [RTDB-FALLBACK] Carregando Woovi do RTDB...');
              wooviConfig.appId = safeDecrypt(rtdbWoovi.appId, 'Woovi RTDB App ID');
              wooviConfig.webhookSecret = safeDecrypt(rtdbWoovi.webhookSecret, 'Woovi RTDB Webhook');
            }
          } catch (e) { console.warn('⚠️ RTDB fallback Woovi falhou'); }
        }
        return wooviConfig;
      })(),
      pagarme: await (async () => {
        let pagarmeConfig: any = {
          enabled: data.pagarme?.enabled === true,
          environment: data.pagarme?.environment || 'test',
          apiKey: data.pagarme?.enabled ? safeDecrypt(data.pagarme?.apiKey, 'Pagar.me API Key') : undefined,
          encryptionKey: data.pagarme?.enabled ? safeDecrypt(data.pagarme?.encryptionKey, 'Pagar.me Encryption Key') : undefined,
          pixFeePercent: data.pagarme?.pixFeePercent ?? 0.99,
          pixFeeFixed: data.pagarme?.pixFeeFixed ?? 0,
          pixReleaseDays: data.pagarme?.pixReleaseDays ?? 1,
          cardFeePercent: data.pagarme?.cardFeePercent ?? 3.99,
          cardFeeFixed: data.pagarme?.cardFeeFixed ?? 0.39,
          cardReleaseDays: data.pagarme?.cardReleaseDays ?? 30,
          boletoFeePercent: data.pagarme?.boletoFeePercent ?? 0,
          boletoFeeFixed: data.pagarme?.boletoFeeFixed ?? 3.49,
          boletoReleaseDays: data.pagarme?.boletoReleaseDays ?? 2,
        };
        if (pagarmeConfig.enabled && !pagarmeConfig.apiKey) {
          try {
            const rtdbPagarme = await loadCredentialsFromRTDB('pagarme');
            if (rtdbPagarme?.apiKey) {
              console.log('🔄 [RTDB-FALLBACK] Carregando Pagar.me do RTDB...');
              pagarmeConfig.apiKey = safeDecrypt(rtdbPagarme.apiKey, 'Pagarme RTDB API Key');
              pagarmeConfig.encryptionKey = safeDecrypt(rtdbPagarme.encryptionKey, 'Pagarme RTDB Encryption Key');
            }
          } catch (e) { console.warn('⚠️ RTDB fallback Pagar.me falhou'); }
        }
        return pagarmeConfig;
      })(),
      updatedBy: data.updatedBy,
      updatedByName: data.updatedByName,
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date(),
    };
    
    console.log('✅ Configurações de pagamento carregadas do Firebase com sucesso');
    console.log('🎯 Adquirente PIX configurado:', config.defaultAcquirers.pix);
    try {
      firestoreCache.setPaymentConfigCache('global', config);
    } catch (e) {}
    return config;
    
  } catch (error) {
    console.error('❌ Erro ao buscar configurações de pagamento:', error);
    try {
      firestoreCache.setPaymentConfigCache('global', null);
    } catch (e) {}
    return null;
  }
}

// 💾 HELPER: SALVAR CONFIGURAÇÕES DE PAGAMENTO NO FIREBASE
export async function savePaymentConfig(
  db: admin.firestore.Firestore,
  config: Partial<PaymentConfig>,
  adminUid: string,
  adminName: string
): Promise<void> {
  try {
    console.log('💾 Salvando configurações de pagamento no Firebase...');
    console.log('📦 Dados recebidos:', JSON.stringify(config, null, 2));
    
    // 🔐 BUSCAR CONFIGURAÇÃO RAW (CRIPTOGRAFADA) DO BANCO
    const rawDoc = await db.collection('paymentConfig').doc('global').get();
    const rawData = rawDoc.exists ? rawDoc.data() : null;
    console.log('🔍 Configuração RAW carregada (chaves criptografadas)');
    
    // 🔐 BUSCAR CONFIGURAÇÃO DESCRIPTOGRAFADA PARA TAXAS E OUTROS DADOS
    const existingConfig = await getPaymentConfig(db);
    console.log('🔍 Configuração descriptografada carregada para merge de taxas');
    
    // 🔓 HELPER LOCAL: Descriptografar com backward compatibility (cópia da função em getPaymentConfig)
    const safeDecryptLocal = (value: string | undefined, keyName: string = 'chave'): string | undefined => {
      if (!value) return undefined;
      
      if (!value.includes(':') || value.split(':').length !== 3) {
        console.warn(`⚠️ ${keyName} está em formato plain-text (não criptografada)`);
        return value;
      }
      
      try {
        let decrypted = decryptSensitiveData(value);
        if (decrypted.includes(':') && decrypted.split(':').length === 3) {
          try {
            decrypted = decryptSensitiveData(decrypted);
          } catch (error2) {
            // Usa o resultado da primeira descriptografia
          }
        }
        return decrypted;
      } catch (error: any) {
        console.warn(`⚠️ FALLBACK: Usando valor original para ${keyName}`);
        return value;
      }
    };
    
    // 🔐 HELPER: Criptografar apenas se for chave nova (não vazia)
    const smartEncrypt = (newKey: string | undefined, rawExistingKey: string | undefined): string => {
      // Se nova chave está vazia/undefined → MANTER a chave CRIPTOGRAFADA original
      if (!newKey || newKey.trim() === '') {
        console.log('⏭️ Nova chave vazia - mantendo chave CRIPTOGRAFADA existente');
        return rawExistingKey || '';
      }
      
      // 🔍 Verificar se a nova chave já está criptografada (formato IV:AuthTag:Encrypted)
      const isEncrypted = newKey.includes(':') && newKey.split(':').length === 3;
      
      // Se nova chave JÁ está criptografada e é igual à original → VERIFICAR se está CORROMPIDA
      if (isEncrypted && newKey === rawExistingKey) {
        // 🔍 Testar se consegue descriptografar - se falhar, está CORROMPIDA!
        try {
          const testDecrypt = safeDecryptLocal(rawExistingKey);
          if (testDecrypt === rawExistingKey) {
            // Falhou ao descriptografar - chave CORROMPIDA!
            console.log('🚨 CHAVE CORROMPIDA DETECTADA - impossível descriptografar!');
            console.log('⚠️ SOLUÇÃO: Usuário DEVE re-digitar credenciais reais no painel');
            return rawExistingKey; // Manter para não perder - usuário precisa substituir manualmente
          }
          // Descriptografou OK - chave válida
          console.log('✅ Chave CRIPTOGRAFADA válida - mantendo');
          return rawExistingKey;
        } catch (err) {
          // Erro ao descriptografar - CORROMPIDA!
          console.log('🚨 CHAVE CORROMPIDA - erro ao testar descriptografia');
          return rawExistingKey; // Manter para não perder
        }
      }
      
      // Se nova chave NÃO está criptografada → CRIPTOGRAFAR
      if (!isEncrypted) {
        console.log('🔐 Nova chave PLAIN-TEXT detectada - criptografando...');
        return encryptSensitiveData(newKey);
      }
      
      // Se nova chave está criptografada mas é diferente → ACEITAR (já tá criptografada)
      console.log('✅ Nova chave já CRIPTOGRAFADA - salvando');
      return newKey;
    };
    
    // 🔄 Garantir estrutura nova mesmo se vier estrutura antiga
    let defaultAcquirers: any = config.defaultAcquirers || {
      pix: 'woovi',
      creditCardBR: 'efibank',
      creditCardGlobal: 'stripe',
      boleto: 'woovi',
    };
    
    // Migrar se ainda vier com estrutura antiga
    if ('creditCard' in defaultAcquirers) {
      const legacyValue = defaultAcquirers.creditCard;
      
      // GATEWAYS INTERNACIONAIS (processam em USD/EUR)
      if (legacyValue === 'stripe' || legacyValue === 'adyen') {
        defaultAcquirers.creditCardGlobal = legacyValue;
        defaultAcquirers.creditCardBR = 'efibank'; // Fallback brasileiro
      }
      // GATEWAYS BRASILEIROS (processam em BRL)
      else if (legacyValue === 'efibank' || legacyValue === 'pagarme') {
        defaultAcquirers.creditCardBR = legacyValue;
        defaultAcquirers.creditCardGlobal = 'stripe'; // Fallback internacional
      }
      // FALLBACK GENÉRICO
      else {
        defaultAcquirers.creditCardBR = 'efibank';
        defaultAcquirers.creditCardGlobal = 'stripe';
      }
      delete defaultAcquirers.creditCard;
    }
    
    // 🔒 PRESERVAR TAXAS ETERNAS (merge com existentes)
    const mergedFees = {
      pixFixedFee: config.fees?.pixFixedFee ?? existingConfig?.fees?.pixFixedFee ?? 249, // 🔒 R$ 2,49 ETERNO
      pixPercentFee: config.fees?.pixPercentFee ?? existingConfig?.fees?.pixPercentFee ?? 2.99,
      pixReleaseDays: config.fees?.pixReleaseDays ?? existingConfig?.fees?.pixReleaseDays ?? 0, // 🔒 D+0 ETERNO
      creditCardBRFixedFee: config.fees?.creditCardBRFixedFee ?? (config.fees as any)?.creditCardFixedFee ?? existingConfig?.fees?.creditCardBRFixedFee ?? (existingConfig?.fees as any)?.creditCardFixedFee ?? 249, // 🔒 R$ 2,49 ETERNO
      creditCardBRPercentFee: config.fees?.creditCardBRPercentFee ?? (config.fees as any)?.creditCardPercentFee ?? existingConfig?.fees?.creditCardBRPercentFee ?? (existingConfig?.fees as any)?.creditCardPercentFee ?? 5.2, // 🔒 5,2% ETERNO
      creditCardBRReleaseDays: config.fees?.creditCardBRReleaseDays ?? (config.fees as any)?.creditCardReleaseDays ?? existingConfig?.fees?.creditCardBRReleaseDays ?? (existingConfig?.fees as any)?.creditCardReleaseDays ?? 20, // 🔒 D+20 ETERNO
      creditCardGlobalFixedFee: config.fees?.creditCardGlobalFixedFee ?? (config.fees as any)?.creditCardFixedFee ?? existingConfig?.fees?.creditCardGlobalFixedFee ?? (existingConfig?.fees as any)?.creditCardFixedFee ?? 49,
      creditCardGlobalPercentFee: config.fees?.creditCardGlobalPercentFee ?? (config.fees as any)?.creditCardPercentFee ?? existingConfig?.fees?.creditCardGlobalPercentFee ?? (existingConfig?.fees as any)?.creditCardPercentFee ?? 4.99,
      creditCardGlobalReleaseDays: config.fees?.creditCardGlobalReleaseDays ?? (config.fees as any)?.creditCardReleaseDays ?? existingConfig?.fees?.creditCardGlobalReleaseDays ?? (existingConfig?.fees as any)?.creditCardReleaseDays ?? 30,
      boletoFixedFee: config.fees?.boletoFixedFee ?? existingConfig?.fees?.boletoFixedFee ?? 349,
      boletoPercentFee: config.fees?.boletoPercentFee ?? existingConfig?.fees?.boletoPercentFee ?? 0,
      boletoReleaseDays: config.fees?.boletoReleaseDays ?? existingConfig?.fees?.boletoReleaseDays ?? 2,
    };
    
    console.log('🔒 TAXAS ETERNAS PRESERVADAS:', mergedFees);
    
    const encryptedConfig: any = {
      id: 'global',
      defaultAcquirers,
      fees: mergedFees,
      stripe: config.stripe ? {
        enabled: config.stripe.enabled,
        environment: config.stripe.environment,
        publicKey: config.stripe.publicKey || existingConfig?.stripe?.publicKey || '',
        secretKey: smartEncrypt(config.stripe.secretKey, rawData?.stripe?.secretKey),
        webhookSecret: smartEncrypt(config.stripe.webhookSecret, rawData?.stripe?.webhookSecret),
      } : undefined,
      efibank: config.efibank ? {
        enabled: config.efibank.enabled,
        environment: config.efibank.environment,
        productionClientId: smartEncrypt(config.efibank.productionClientId, rawData?.efibank?.productionClientId),
        productionClientSecret: smartEncrypt(config.efibank.productionClientSecret, rawData?.efibank?.productionClientSecret),
        sandboxClientId: smartEncrypt(config.efibank.sandboxClientId, rawData?.efibank?.sandboxClientId),
        sandboxClientSecret: smartEncrypt(config.efibank.sandboxClientSecret, rawData?.efibank?.sandboxClientSecret),
        payeeCode: config.efibank.payeeCode || existingConfig?.efibank?.payeeCode || '',
        pixKey: config.efibank.pixKey || existingConfig?.efibank?.pixKey || '',
        certificatePath: config.efibank.certificatePath || existingConfig?.efibank?.certificatePath || '',
        certificateStoragePath: (config.efibank as any).certificateStoragePath || rawData?.efibank?.certificateStoragePath || (existingConfig?.efibank as any)?.certificateStoragePath || '',
        certificateUpdatedAt: (config.efibank as any).certificateUpdatedAt || rawData?.efibank?.certificateUpdatedAt || (existingConfig?.efibank as any)?.certificateUpdatedAt,
      } : undefined,
      adyen: config.adyen ? {
        enabled: config.adyen.enabled,
        environment: config.adyen.environment,
        apiKey: smartEncrypt(config.adyen.apiKey, rawData?.adyen?.apiKey),
        merchantAccount: config.adyen.merchantAccount || existingConfig?.adyen?.merchantAccount || '',
        clientKey: config.adyen.clientKey || existingConfig?.adyen?.clientKey || '',
      } : undefined,
      woovi: config.woovi ? {
        enabled: config.woovi.enabled ?? false,
        environment: config.woovi.environment || 'sandbox',
        appId: smartEncrypt(config.woovi.appId, rawData?.woovi?.appId),
        webhookSecret: smartEncrypt(config.woovi.webhookSecret, rawData?.woovi?.webhookSecret),
      } : undefined,
      pagarme: config.pagarme ? {
        enabled: config.pagarme.enabled ?? false,
        environment: config.pagarme.environment || 'test',
        apiKey: smartEncrypt(config.pagarme.apiKey, rawData?.pagarme?.apiKey),
        encryptionKey: smartEncrypt(config.pagarme.encryptionKey, rawData?.pagarme?.encryptionKey),
        pixFeePercent: config.pagarme.pixFeePercent ?? 0.99,
        pixFeeFixed: config.pagarme.pixFeeFixed ?? 0,
        pixReleaseDays: config.pagarme.pixReleaseDays ?? 1,
        cardFeePercent: config.pagarme.cardFeePercent ?? 3.99,
        cardFeeFixed: config.pagarme.cardFeeFixed ?? 0.39,
        cardReleaseDays: config.pagarme.cardReleaseDays ?? 30,
        boletoFeePercent: config.pagarme.boletoFeePercent ?? 0,
        boletoFeeFixed: config.pagarme.boletoFeeFixed ?? 3.49,
        boletoReleaseDays: config.pagarme.boletoReleaseDays ?? 2,
      } : undefined,
      bunny: config.bunny ? {
        enabled: config.bunny.enabled ?? false,
        streamLibraryId: config.bunny.streamLibraryId || existingConfig?.bunny?.streamLibraryId || '',
        streamApiKey: smartEncrypt(config.bunny.streamApiKey, rawData?.bunny?.streamApiKey),
        storageApiKey: smartEncrypt(config.bunny.storageApiKey, rawData?.bunny?.storageApiKey),
        storageZoneName: config.bunny.storageZoneName || existingConfig?.bunny?.storageZoneName || '',
        storageRegion: config.bunny.storageRegion || existingConfig?.bunny?.storageRegion || 'de',
      } : undefined,
      updatedBy: adminUid,
      updatedByName: adminName,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    // 🧹 FUNÇÃO HELPER: Remover recursivamente todos os undefined (PRESERVAR false/0/null)
    function removeUndefined(obj: any): any {
      if (obj === null) return null;
      if (obj === undefined) return null;
      if (typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(removeUndefined);
      
      const cleaned: any = {};
      for (const [key, value] of Object.entries(obj)) {
        // ✅ PRESERVAR false, 0, null - só remover undefined
        if (value !== undefined) {
          cleaned[key] = removeUndefined(value);
        }
      }
      return cleaned;
    }
    
    // Limpar todos os undefined do objeto (recursivamente)
    const cleanConfig = removeUndefined(encryptedConfig);
    
    // ✅ GARANTIR QUE O DOCUMENTO EXISTA ANTES DE FAZER MERGE
    const docRef = db.collection('paymentConfig').doc('global');
    const existingDoc = await docRef.get();
    
    if (existingDoc.exists) {
      // ✅ MERGE: Atualizar campos mantendo createdAt original
      await docRef.update({
        ...cleanConfig,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('✅ Configurações de pagamento ATUALIZADAS com sucesso no Firebase');
    } else {
      await docRef.set({
        ...cleanConfig,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('✅ Configurações de pagamento CRIADAS com sucesso no Firebase');
    }
    try {
      firestoreCache.invalidatePaymentConfig();
    } catch (e) {}
    
    syncAllAcquirersToRTDB(cleanConfig).catch(err =>
      console.error('⚠️ [ETERNAL-SYNC] Erro async adquirentes:', err?.message)
    );
    
    syncAllCredentialsToRTDB(cleanConfig).catch(err =>
      console.error('⚠️ [ETERNAL-SYNC] Erro async credenciais RTDB:', err?.message)
    );
    
    if (cleanConfig.fees) {
      syncGlobalFeesToRTDB(cleanConfig.fees, adminName).catch(err =>
        console.error('⚠️ [ETERNAL-SYNC] Erro async taxas:', err?.message)
      );
      syncWithdrawalConfigToRTDB(cleanConfig.fees).catch(err =>
        console.error('⚠️ [ETERNAL-SYNC] Erro async prazos:', err?.message)
      );
    }
    
  } catch (error: any) {
    console.error('❌ ERRO CRÍTICO ao salvar configurações:');
    console.error('❌ Error stringified:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    console.error('❌ Error Message:', error?.message);
    console.error('❌ Error Stack:', error?.stack);
    console.error('❌ Error Name:', error?.name);
    console.error('❌ Error Code:', error?.code);
    throw error;
  }
}

// 🔑 HELPER: BUSCAR CHAVES STRIPE (com fallback para environment)
export async function getStripeKeys(db: admin.firestore.Firestore): Promise<{
  publicKey: string;
  secretKey: string;
  environment: 'test' | 'production';
}> {
  const config = await getPaymentConfig(db);
  
  if (config?.stripe && config.stripe.publicKey && config.stripe.secretKey) {
    console.log('✅ Usando chaves Stripe do Firebase (admin configurado)');
    return {
      publicKey: config.stripe.publicKey,
      secretKey: config.stripe.secretKey,
      environment: config.stripe.environment,
    };
  }
  
  // FALLBACK: usar environment variables
  console.log('⚠️ Usando chaves Stripe do environment (fallback)');
  return {
    publicKey: process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || '',
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    environment: process.env.STRIPE_SECRET_KEY?.includes('_live_') ? 'production' : 'test',
  };
}

// 🏦 HELPER: BUSCAR CHAVES EFIBANK (com fallback para environment)
export async function getEfiBankKeys(db: admin.firestore.Firestore): Promise<{
  clientId: string;
  clientSecret: string;
  payeeCode: string;
  pixKey: string;
  environment: 'sandbox' | 'production';
}> {
  const ensureDecrypted = (value: string | undefined, keyName: string): string | undefined => {
    if (!value) return undefined;
    if (!value.includes(':') || value.split(':').length !== 3) {
      return value;
    }
    try {
      let decrypted = decryptSensitiveData(value);
      if (decrypted.includes(':') && decrypted.split(':').length === 3) {
        try {
          decrypted = decryptSensitiveData(decrypted);
        } catch (e) {}
      }
      return decrypted;
    } catch (error: any) {
      console.error(`❌ [getEfiBankKeys] Falha ao descriptografar ${keyName}:`, error.message);
      return undefined;
    }
  };

  const config = await getPaymentConfig(db);
  
  if (config?.efibank) {
    // Se environment não está definido, assume production (credentials salvas são sempre de produção)
    const isProduction = !config.efibank.environment || config.efibank.environment === 'production';
    // Prioriza credenciais de produção se existirem, mesmo que environment não declarado
    let clientId = config.efibank.productionClientId || (isProduction ? '' : config.efibank.sandboxClientId);
    let clientSecret = config.efibank.productionClientSecret || (isProduction ? '' : config.efibank.sandboxClientSecret);
    
    clientId = ensureDecrypted(clientId, 'Client ID');
    clientSecret = ensureDecrypted(clientSecret, 'Client Secret');
    
    if (clientId && clientSecret) {
      return {
        clientId,
        clientSecret,
        payeeCode: config.efibank.payeeCode || process.env.EFIBANK_PAYEE_CODE || '',
        pixKey: config.efibank.pixKey || process.env.EFIBANK_PIX_KEY || '',
        environment: config.efibank.environment,
      };
    }
  }
  
  // FALLBACK: usar environment variables
  const isProductionEnv = process.env.EFIBANK_SANDBOX === 'false';
  console.log(`⚠️ Usando chaves EfíBank do environment (fallback - ${isProductionEnv ? 'production' : 'sandbox'})`);
  
  return {
    clientId: isProductionEnv ? (process.env.EFI_CLIENT_ID || '') : (process.env.EFI_CLIENT_ID_SANDBOX || ''),
    clientSecret: isProductionEnv ? (process.env.EFI_CLIENT_SECRET || '') : (process.env.EFI_CLIENT_SECRET_SANDBOX || ''),
    payeeCode: process.env.EFIBANK_PAYEE_CODE || '',
    pixKey: process.env.EFIBANK_PIX_KEY || '',
    environment: isProductionEnv ? 'production' : 'sandbox',
  };
}

// 💰 HELPER: BUSCAR TAXAS (com fallback para valores padrão)
export async function getPaymentFees(db: admin.firestore.Firestore): Promise<{
  pixFixedFee: number;
  pixPercentFee: number;
  pixReleaseDays: number;
  creditCardFixedFee: number;
  creditCardPercentFee: number;
  creditCardReleaseDays: number;
}> {
  const config = await getPaymentConfig(db);
  
  if (config?.fees) {
    console.log('✅ Usando taxas do Firebase (admin configurado)');
    return {
      pixFixedFee: config.fees.pixFixedFee ?? 99,
      pixPercentFee: config.fees.pixPercentFee ?? 2.99,
      pixReleaseDays: config.fees.pixReleaseDays ?? 1,
      creditCardFixedFee: config.fees.creditCardFixedFee ?? 49,
      creditCardPercentFee: config.fees.creditCardPercentFee ?? 4.99,
      creditCardReleaseDays: config.fees.creditCardReleaseDays ?? 30,
    };
  }
  
  // FALLBACK: taxas padrão
  console.log('⚠️ Usando taxas padrão (fallback)');
  return {
    pixFixedFee: 99, // R$ 0,99
    pixPercentFee: 2.99, // 2.99%
    pixReleaseDays: 1, // 1 dia
    creditCardFixedFee: 49, // R$ 0,49
    creditCardPercentFee: 4.99, // 4.99%
    creditCardReleaseDays: 30, // 30 dias
  };
}
