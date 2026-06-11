import { Router, type Response } from 'express';
import {
  verifyFirebaseToken,
  requireAdmin,
  AuthenticatedRequest
} from '../security/firebase-auth.js';
import { ensureFirebaseReady, getAdmin, getFirestore } from '../lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { storage } from '../storage.js';
import { getPaymentConfig } from '../lib/payment-config.js';
import { syncCertificateToRTDB, syncGlobalFeesToRTDB, syncWithdrawalConfigToRTDB } from '../lib/eternal-sync.js';
import fs from 'fs';
import path from 'path';

export function createAdminConfigRouter(getStripeConfigCache: () => any) {
  const adminConfigRouter = Router();

// 🌍 ENDPOINT PÚBLICO PARA CONFIGURAÇÕES BÁSICAS - SEM RATE LIMIT (público)
adminConfigRouter.get('/api/public/configurations', async (req, res) => {
  try {
    // ✅ RETORNAR CONFIGURAÇÕES PADRÃO SEMPRE (rápido e sem timeout)
    return res.json({
      gatewayName: 'VolatusPay',
      companyRegistration: '',
      companyAddress: '',
      companyPhone: '',
      companyEmail: 'volatuspay@gmail.com',
      siteTitle: 'VolatusPay',
      siteSubtitle: 'Gateway de Pagamentos Completo',
      siteDescription: 'O melhor Gateway de pagamentos do Brasil',
      primaryColor: '#10B981',
      secondaryColor: '#06b6d4', 
      backgroundColor: '#ffffff',
      textColor: '#1f2937'
    });
  } catch (error) {
    console.error('❌ Erro geral ao buscar configurações públicas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 BUSCAR CONFIGURAÇÕES ADMIN COMPLETAS (DADOS + VISUAL) - 🛡️ PROTEGIDO
adminConfigRouter.get('/api/admin/configurations', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🎨 GET - Buscando configurações admin...');
    
    // Aguardar storage estar pronto
    let retries = 0;
    while (!(storage as any).db && retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }

    if (!(storage as any).db) {
      console.log('🎨 Storage não pronto, retornando configurações padrão');
      return res.json({
        // DADOS - NOVOS NOMES
        gatewayName: 'VolatusPay',
        companyRegistration: '',
        companyAddress: '',
        companyPhone: '',
        companyEmail: 'volatuspay@gmail.com',
        
        // SEO
        siteTitle: 'VolatusPay',
        siteSubtitle: 'Gateway de Pagamentos',
        siteDescription: 'O melhor Gateway de pagamentos do Brasil',
        
        // VISUAL - NOVOS NOMES
        primaryColor: '#10B981',
        secondaryColor: '#06b6d4', 
        backgroundColor: '#ffffff',
        textColor: '#1f2937',
        headerLogoUrl: '',
        siteLogoUrl: '',
        
        // METADATA
        lastUpdated: new Date(),
        updatedBy: 'system'
      });
    }

    try {
      const configRef = (storage as any).db.collection('admin').doc('app-configurations');
      const configDoc = await configRef.get();
      
      if (configDoc.exists) {
        const data = configDoc.data();
        console.log('🎨 Configurações encontradas:', { ...data, updatedBy: data.updatedBy || 'unknown' });
        res.json(data);
      } else {
        console.log('🎨 Configurações não encontradas, criando configurações padrão...');
        
        const defaultConfig = {
          // DADOS - NOVOS NOMES
          gatewayName: 'VolatusPay',
          companyRegistration: '',
          companyAddress: '',
          companyPhone: '',
          companyEmail: 'volatuspay@gmail.com',
          
          // SEO
          siteTitle: 'VolatusPay',
          siteSubtitle: 'Gateway de Pagamentos',
          siteDescription: 'O melhor Gateway de pagamentos do Brasil',
          
          // VISUAL - NOVOS NOMES
          primaryColor: '#10B981',
          secondaryColor: '#06b6d4', 
          backgroundColor: '#ffffff',
          textColor: '#1f2937',
          headerLogoUrl: '',
          siteLogoUrl: '',
          
          // METADATA
          lastUpdated: new Date(),
          updatedBy: 'system'
        };
        
        await configRef.set(defaultConfig);
        console.log('🎨 Configurações padrão criadas');
        res.json(defaultConfig);
      }
    } catch (error) {
      console.error('❌ Erro ao buscar configurações:', error);
      res.status(500).json({ error: 'Erro ao buscar configurações' });
    }
    
  } catch (error: any) {
    console.error('❌ Erro geral nas configurações:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor'
      // SECURITY: Details removed to prevent information disclosure
    });
  }
});

// 💾 SALVAR CONFIGURAÇÕES ADMIN (DADOS + VISUAL) - 🛡️ PROTEGIDO
adminConfigRouter.put('/api/admin/configurations', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🎨 PUT - Salvando configurações admin...');
    console.log('🎨 Configurações sendo atualizadas pelo admin');
    
    // Aguardar storage estar pronto
    let retries = 0;
    while (!(storage as any).db && retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }

    if (!(storage as any).db) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const {
      // DADOS - NOVOS NOMES COM RETROCOMPATIBILIDADE
      gatewayName,
      companyRegistration,
      companyAddress,
      companyPhone, 
      companyEmail,
      // CAMPOS ANTIGOS PARA RETROCOMPATIBILIDADE
      cnpj,
      address,
      phone,
      email,
      
      // SEO
      siteTitle,
      siteSubtitle,
      siteDescription,
      
      // VISUAL - NOVOS NOMES COM RETROCOMPATIBILIDADE
      primaryColor,
      secondaryColor,
      backgroundColor,
      textColor,
      headerLogoUrl,
      siteLogoUrl,
      // CAMPOS ANTIGOS PARA RETROCOMPATIBILIDADE
      sidebarLogoUrl
    } = req.body;

    // Validações básicas
    if (!gatewayName?.trim()) {
      return res.status(400).json({ error: 'Nome do gateway é obrigatório' });
    }

    // Preparar dados para salvar
    const configData = {
      // DADOS - USANDO NOVOS NOMES COM FALLBACK PARA ANTIGOS
      gatewayName: gatewayName?.trim(),
      companyRegistration: (companyRegistration || cnpj)?.trim() || '',
      companyAddress: (companyAddress || address)?.trim() || '',
      companyPhone: (companyPhone || phone)?.trim() || '',
      companyEmail: (companyEmail || email)?.trim() || 'volatuspay@gmail.com',
      
      // SEO
      siteTitle: siteTitle?.trim() || 'VolatusPay',
      siteSubtitle: siteSubtitle?.trim() || 'Gateway de Pagamentos',
      siteDescription: siteDescription?.trim() || 'O melhor Gateway de pagamentos do Brasil',
      
      // VISUAL - USANDO NOVOS NOMES COM FALLBACK PARA ANTIGOS
      primaryColor: primaryColor || '#10B981',
      secondaryColor: secondaryColor || '#06b6d4',
      backgroundColor: backgroundColor || '#ffffff',
      textColor: textColor || '#1f2937',
      headerLogoUrl: (headerLogoUrl || sidebarLogoUrl) || '',
      siteLogoUrl: siteLogoUrl || '',
      
      // METADATA
      lastUpdated: new Date(),
      updatedBy: req.user?.email || 'admin'
    };

    try {
      console.log('🔧 CONFIG DATA ANTES DE SINCRONIZAR:', configData);
      
      // 💾 SALVAR NA COLEÇÃO ADMIN
      const configRef = (storage as any).db.collection('admin').doc('app-configurations');
      await configRef.set(configData, { merge: true });
      
      // 🌍 SINCRONIZAR COM SISTEMA GLOBAL
      console.log('🔧 MAPEANDO DADOS PARA GLOBAL...');
      console.log('🔧 configData.companyRegistration:', configData.companyRegistration);
      console.log('🔧 configData.companyPhone:', configData.companyPhone);
      console.log('🔧 configData.companyEmail:', configData.companyEmail);
      
      const globalConfig = {
        // Dados da empresa - MAPEAMENTO DIRETO E SEGURO
        gatewayName: configData.gatewayName || 'VolatusPay',
        companyRegistration: configData.companyRegistration || companyRegistration || cnpj || '',
        companyAddress: configData.companyAddress || companyAddress || address || '',
        companyPhone: configData.companyPhone || companyPhone || phone || '',
        companyEmail: configData.companyEmail || companyEmail || email || 'volatuspay@gmail.com',
        
        // SEO
        siteTitle: configData.siteTitle || 'VolatusPay',
        siteSubtitle: configData.siteSubtitle || 'Gateway de Pagamentos',
        siteDescription: configData.siteDescription || 'O melhor Gateway de pagamentos do Brasil',
        
        // Cores
        primaryColor: configData.primaryColor || '#10B981',
        secondaryColor: configData.secondaryColor || '#06b6d4',
        backgroundColor: configData.backgroundColor || '#ffffff',
        textColor: configData.textColor || '#1f2937',
        
        // Logos
        headerLogoUrl: configData.headerLogoUrl || headerLogoUrl || sidebarLogoUrl || '',
        siteLogoUrl: configData.siteLogoUrl || siteLogoUrl || '',
        
        // Metadata
        lastUpdated: new Date(),
        updatedBy: configData.updatedBy || 'admin'
      };

      const globalConfigRef = (storage as any).db.collection('adminConfigurations').doc('global');
      await globalConfigRef.set(globalConfig, { merge: true });
      
      console.log('✅ Configurações salvas com sucesso:', configData);
      console.log('🌍 Configurações globais sincronizadas:', globalConfig);
      
      res.json({
        success: true,
        message: 'Configurações salvas e sincronizadas globalmente!',
        data: configData
      });
      
    } catch (error) {
      console.error('❌ Erro ao salvar configurações no Firestore:', error);
      res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
    
  } catch (error: any) {
    console.error('❌ Erro geral ao salvar configurações:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor'
      // SECURITY: Details removed to prevent information disclosure
    });
  }
});

// 🔍 BUSCAR CONFIGURAÇÕES DE PAGAMENTO - ADMIN ONLY
adminConfigRouter.get('/api/admin/payment-config', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔍 GET - Buscando configurações de pagamento...');
    
    // Aguardar Firebase estar pronto
    await ensureFirebaseReady();
    const db = (storage as any).db;
    
    if (!db) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }
    
    // Importar funções helper
    const { getPaymentConfig } = await import('../lib/payment-config.js');
    
    const config = await getPaymentConfig(db);
    
    if (!config || !config.fees) {
      // Retornar configurações padrão se não houver no banco
      return res.json({
        id: 'global',
        defaultAcquirers: {
          pix: 'efibank',
          creditCardBR: 'efibank',
          creditCardGlobal: 'stripe',
          boleto: 'efibank',
        },
        fees: {
          pixFixedFee: 99,
          pixPercentFee: 2.99,
          pixReleaseDays: 1,
          creditCardFixedFee: 49,
          creditCardPercentFee: 4.99,
          creditCardReleaseDays: 30,
          boletoFixedFee: 349,
          boletoPercentFee: 0,
          boletoReleaseDays: 2,
        },
        stripe: {
          enabled: true,
          environment: 'test',
          publicKey: '',
          secretKey: '',
          webhookSecret: '',
        },
        efibank: {
          enabled: true,
          environment: 'sandbox',
          productionClientId: '',
          productionClientSecret: '',
          sandboxClientId: '',
          sandboxClientSecret: '',
          payeeCode: '',
          pixKey: '',
          certificatePath: '',
        },
        adyen: {
          enabled: false,
          environment: 'test',
          apiKey: '',
          merchantAccount: '',
          clientKey: '',
        },
        woovi: {
          enabled: false,
          environment: 'sandbox',
          appId: '',
          webhookSecret: '',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    
    res.json(config);
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar configurações de pagamento:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar configurações de pagamento',
      details: error.message
    });
  }
});

// 💾 SALVAR CONFIGURAÇÕES DE PAGAMENTO - ADMIN ONLY
adminConfigRouter.post('/api/admin/payment-config', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('💾 POST - Salvando configurações de pagamento...');
    
    // Aguardar Firebase estar pronto
    await ensureFirebaseReady();
    const db = (storage as any).db;
    
    if (!db) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }
    
    const { defaultAcquirers, fees, stripe, efibank, adyen, woovi, pagarme, bunny } = req.body;
    
    // Validar dados básicos
    if (!defaultAcquirers && !fees && !stripe && !efibank && !adyen && !woovi && !pagarme && !bunny) {
      return res.status(400).json({ error: 'Nenhuma configuração fornecida' });
    }
    
    // Importar funções helper
    const { savePaymentConfig } = await import('../lib/payment-config.js');
    
    const adminUid = req.user?.uid || 'unknown';
    const adminName = req.user?.email || 'admin';
    
    await savePaymentConfig(db, { defaultAcquirers, fees, stripe, efibank, adyen, woovi, pagarme, bunny }, adminUid, adminName);
    
    // 🔄 SINCRONIZAR TODOS OS ADQUIRENTES + TAXAS EM ACQUIRERS-CONFIG (ETERNO!)
    console.log('🔄 Sincronizando TODOS os adquirentes + taxas em admin/acquirers-config...');
    try {
      const acquirersConfigRef = db.collection('admin').doc('acquirers-config');
      const acquirersDoc = await acquirersConfigRef.get();
      
      // Preparar configuração completa de TODOS os adquirentes
      const fullAcquirersConfig: any = {
        lastUpdated: new Date(),
        updatedBy: adminName,
      };
      
      // 💰 TAXAS ETERNAS (salvar de forma permanente)
      if (fees) {
        console.log('💰 Salvando taxas ETERNAS:');
        console.log(`   PIX: R$ ${(fees.pixFixedFee || 0) / 100} + ${fees.pixPercentFee || 0}% (D+${fees.pixReleaseDays || 0})`);
        console.log(`   Cartão BR: R$ ${(fees.creditCardBRFixedFee || 0) / 100} + ${fees.creditCardBRPercentFee || 0}% (D+${fees.creditCardBRReleaseDays || 0})`);
        console.log(`   Cartão Global: R$ ${(fees.creditCardGlobalFixedFee || 0) / 100} + ${fees.creditCardGlobalPercentFee || 0}% (D+${fees.creditCardGlobalReleaseDays || 0})`);
        console.log(`   Boleto: R$ ${(fees.boletoFixedFee || 0) / 100} + ${fees.boletoPercentFee || 0}% (D+${fees.boletoReleaseDays || 0})`);
        
        fullAcquirersConfig.fees = {
          pix: {
            fixedFee: fees.pixFixedFee || 99,
            percentFee: fees.pixPercentFee || 2.99,
            releaseDays: fees.pixReleaseDays || 1,
          },
          creditCardBR: {
            fixedFee: fees.creditCardBRFixedFee || 49,
            percentFee: fees.creditCardBRPercentFee || 4.99,
            releaseDays: fees.creditCardBRReleaseDays || 30,
          },
          creditCardGlobal: {
            fixedFee: fees.creditCardGlobalFixedFee || 49,
            percentFee: fees.creditCardGlobalPercentFee || 4.99,
            releaseDays: fees.creditCardGlobalReleaseDays || 30,
          },
          boleto: {
            fixedFee: fees.boletoFixedFee || 349,
            percentFee: fees.boletoPercentFee || 0,
            releaseDays: fees.boletoReleaseDays || 2,
          },
        };
      }
      
      // 🏦 EFIBANK
      if (efibank) {
        fullAcquirersConfig.efibank = {
          enabled: efibank.enabled ?? false,
          environment: efibank.environment || 'production',
          pixFeePercent: fees?.pixPercentFee || 2.99,
          pixFixedFee: fees?.pixFixedFee || 99,
          cardFeePercent: fees?.creditCardBRPercentFee || 4.99,
          cardFixedFee: fees?.creditCardBRFixedFee || 49,
          boletoFeePercent: fees?.boletoPercentFee || 0,
          boletoFixedFee: fees?.boletoFixedFee || 349,
        };
      }
      
      // 💳 STRIPE
      if (stripe) {
        fullAcquirersConfig.stripe = {
          enabled: stripe.enabled ?? false,
          environment: stripe.environment || 'production',
          cardFeePercent: fees?.creditCardGlobalPercentFee || 4.99,
          cardFixedFee: fees?.creditCardGlobalFixedFee || 49,
        };
      }
      
      // 🌍 ADYEN
      if (adyen) {
        fullAcquirersConfig.adyen = {
          enabled: adyen.enabled ?? false,
          environment: adyen.environment || 'test',
          cardFeePercent: fees?.creditCardGlobalPercentFee || 4.99,
          cardFixedFee: fees?.creditCardGlobalFixedFee || 49,
        };
      }
      
      // 🟢 WOOVI
      if (woovi) {
        fullAcquirersConfig.woovi = {
          enabled: woovi.enabled ?? false,
          environment: woovi.environment || 'sandbox',
          pixFeePercent: fees?.pixPercentFee || 1.99,
          pixFixedFee: fees?.pixFixedFee || 99,
        };
      }
      
      // 🟣 PAGAR.ME
      if (pagarme) {
        fullAcquirersConfig.pagarme = {
          enabled: pagarme.enabled ?? false,
          environment: pagarme.environment || 'test',
          pixFeePercent: fees?.pixPercentFee || 2.99,
          pixFeeFixed: fees?.pixFixedFee || 99,
          cardFeePercent: fees?.creditCardBRPercentFee || 4.99,
          cardFixedFee: fees?.creditCardBRFixedFee || 49,
          boletoFeePercent: fees?.boletoPercentFee || 0,
          boletoFixedFee: fees?.boletoFixedFee || 349,
        };
      }
      
      // 🐰 BUNNY.NET (salvar apenas metadados não-sensíveis - chaves API ficam criptografadas em paymentConfig)
      if (bunny) {
        fullAcquirersConfig.bunny = {
          enabled: bunny.enabled ?? false,
          streamLibraryId: bunny.streamLibraryId || '',
          storageZoneName: bunny.storageZoneName || '',
          storageRegion: bunny.storageRegion || 'de',
        };
      }
      
      // Salvar ou atualizar configuração
      if (acquirersDoc.exists) {
        await acquirersConfigRef.update(fullAcquirersConfig);
        console.log('✅ TODOS os adquirentes + taxas sincronizados (update)');
      } else {
        await acquirersConfigRef.set(fullAcquirersConfig);
        console.log('✅ TODOS os adquirentes + taxas sincronizados (create)');
      }
      
      console.log('✅ Configurações ETERNAS salvas em admin/acquirers-config!');
      
    } catch (syncError) {
      console.error('⚠️ Erro ao sincronizar acquirers-config:', syncError);
      // Não falhar a requisição, apenas logar o erro
    }
    
    // 🔄 APLICAR CONFIGURAÇÕES EM TODOS OS CHECKOUTS EXISTENTES
    let checkoutsUpdated = 0;
    if (defaultAcquirers) {
      console.log('🔄 Aplicando adquirentes padrão em todos os checkouts existentes...');
      try {
        const checkoutsSnapshot = await db.collection('checkouts').get();
        
        if (!checkoutsSnapshot.empty) {
          const batch = db.batch();
          
          checkoutsSnapshot.forEach((checkoutDoc: any) => {
            const checkoutData = checkoutDoc.data();
            const marketTarget = checkoutData.marketTarget || 'brasil';
            
            // Preparar configurações de adquirentes baseado no marketTarget
            const checkoutAcquirers: any = {};
            
            if (marketTarget === 'brasil') {
              // Brasil: PIX, Boleto, Cartão BR
              if (defaultAcquirers.pix) {
                checkoutAcquirers.pix = {
                  enabled: true,
                  acquirer: defaultAcquirers.pix
                };
              }
              if (defaultAcquirers.boleto) {
                checkoutAcquirers.boleto = {
                  enabled: true,
                  acquirer: defaultAcquirers.boleto
                };
              }
              if (defaultAcquirers.creditCardBR || defaultAcquirers.creditCard) {
                checkoutAcquirers.creditCard = {
                  enabled: true,
                  acquirer: defaultAcquirers.creditCardBR || defaultAcquirers.creditCard
                };
              }
            } else {
              // Global: Cartão Internacional
              if (defaultAcquirers.creditCardGlobal || defaultAcquirers.creditCard) {
                checkoutAcquirers.creditCard = {
                  enabled: true,
                  acquirer: defaultAcquirers.creditCardGlobal || defaultAcquirers.creditCard
                };
              }
            }
            
            // Atualizar checkout
            batch.update(checkoutDoc.ref, {
              acquirers: checkoutAcquirers,
              updatedAt: FieldValue.serverTimestamp(),
            });
            
            checkoutsUpdated++;
          });
          
          await batch.commit();
          console.log(`✅ ${checkoutsUpdated} checkouts atualizados com adquirentes padrão!`);
          console.log(`   PIX: ${defaultAcquirers.pix || 'N/A'}`);
          console.log(`   Boleto: ${defaultAcquirers.boleto || 'N/A'}`);
          console.log(`   Cartão BR: ${defaultAcquirers.creditCardBR || defaultAcquirers.creditCard || 'N/A'}`);
          console.log(`   Cartão Global: ${defaultAcquirers.creditCardGlobal || 'N/A'}`);
        }
      } catch (updateError) {
        console.error('⚠️ Erro ao atualizar checkouts:', updateError);
        // Não falhar a requisição, apenas logar o erro
      }
    }
    
    // 🔄 APLICAR ADQUIRENTES PADRÃO EM TODOS OS SELLERS EXISTENTES
    let sellersUpdated = 0;
    if (defaultAcquirers) {
      console.log('🔄 Aplicando adquirentes padrão em todos os sellers existentes...');
      try {
        const sellersSnapshot = await db.collection('sellers').get();
        if (!sellersSnapshot.empty) {
          const docs = sellersSnapshot.docs;
          for (let i = 0; i < docs.length; i += 400) {
            const chunk = docs.slice(i, i + 400);
            const batch = db.batch();
            chunk.forEach((sellerDoc: any) => {
              const updFields: any = { updatedAt: FieldValue.serverTimestamp() };
              if (defaultAcquirers.pix) {
                updFields['acquirers.pix'] = defaultAcquirers.pix;
                updFields['acquirerConfig.pixAcquirer'] = defaultAcquirers.pix;
              }
              if (defaultAcquirers.boleto) {
                updFields['acquirers.boleto'] = defaultAcquirers.boleto;
              }
              const brAcq = defaultAcquirers.creditCardBR || defaultAcquirers.creditCard;
              if (brAcq) {
                updFields['acquirers.creditCardBR'] = brAcq;
                updFields['acquirers.creditCard'] = brAcq;
                updFields['acquirerConfig.brazilianCardAcquirer'] = brAcq;
              }
              if (defaultAcquirers.creditCardGlobal) {
                updFields['acquirers.creditCardGlobal'] = defaultAcquirers.creditCardGlobal;
                updFields['acquirerConfig.globalCardAcquirer'] = defaultAcquirers.creditCardGlobal;
              }
              batch.update(sellerDoc.ref, updFields);
              sellersUpdated++;
            });
            await batch.commit();
          }
          console.log(`✅ ${sellersUpdated} sellers atualizados com adquirentes padrão!`);
        }
      } catch (sellerUpdateErr: any) {
        console.error('⚠️ Erro ao atualizar sellers (não crítico):', sellerUpdateErr?.message);
      }
    }

    // 🔐 SYNC ETERNO DO CERTIFICADO: Se existir localmente e não estiver no RTDB, salvar no RTDB agora
    const LOCAL_CERT = path.join(process.cwd(), 'certs', 'efi-prod.p12');
    if (fs.existsSync(LOCAL_CERT)) {
      try {
        const certBuf = fs.readFileSync(LOCAL_CERT);
        if (certBuf.length > 256) {
          const rtdb = getAdmin().database();
          const snap = await rtdb.ref('system/certificates/efibank-prod').once('value');
          if (!snap.exists() || !snap.val()?.base64) {
            await syncCertificateToRTDB(certBuf, 'auto-sync-payment-config');
            console.log('🔐 Certificado sincronizado para RTDB via POST payment-config');
          }
        }
      } catch (certSyncErr: any) {
        console.warn('⚠️ Sync de certificado (não crítico):', certSyncErr?.message);
      }
    }

    // 🔄 SYNC ETERNO DAS TAXAS: Se fees foram fornecidas, sincronizar com RTDB e globalFeeConfig
    if (fees) {
      try {
        const feesForRTDB = {
          pixFixedFee: fees.pixFixedFee ?? 99,
          pixPercentFee: fees.pixPercentFee ?? 2.99,
          pixReleaseDays: fees.pixReleaseDays ?? 1,
          creditCardBRFixedFee: fees.creditCardBRFixedFee ?? 249,
          creditCardBRPercentFee: fees.creditCardBRPercentFee ?? 5.2,
          creditCardBRReleaseDays: fees.creditCardBRReleaseDays ?? 20,
          creditCardGlobalFixedFee: fees.creditCardGlobalFixedFee ?? 49,
          creditCardGlobalPercentFee: fees.creditCardGlobalPercentFee ?? 4.99,
          creditCardGlobalReleaseDays: fees.creditCardGlobalReleaseDays ?? 30,
          boletoFixedFee: fees.boletoFixedFee ?? 349,
          boletoPercentFee: fees.boletoPercentFee ?? 0,
          boletoReleaseDays: fees.boletoReleaseDays ?? 2,
        };
        syncGlobalFeesToRTDB(feesForRTDB, adminName).catch((e: any) =>
          console.warn('⚠️ Sync de taxas (não crítico):', e?.message)
        );
        syncWithdrawalConfigToRTDB({
          pixReleaseDays: feesForRTDB.pixReleaseDays,
          creditCardBRReleaseDays: feesForRTDB.creditCardBRReleaseDays,
          creditCardGlobalReleaseDays: feesForRTDB.creditCardGlobalReleaseDays,
          boletoReleaseDays: feesForRTDB.boletoReleaseDays,
        }).catch((e: any) =>
          console.warn('⚠️ Sync de prazos (não crítico):', e?.message)
        );

        // 🔄 Manter globalFeeConfig/globalConfig sincronizado também
        try {
          const globalFeeRef = db.collection('globalFeeConfig').doc('globalConfig');
          const globalFeeDoc = await globalFeeRef.get();
          const mergedGlobal: any = {
            ...(globalFeeDoc.exists ? globalFeeDoc.data() : {}),
            pix: { fixedFee: feesForRTDB.pixFixedFee, percentFee: feesForRTDB.pixPercentFee, releaseDays: feesForRTDB.pixReleaseDays },
            creditCardBR_D30: { fixedFee: feesForRTDB.creditCardBRFixedFee, percentFee: feesForRTDB.creditCardBRPercentFee, releaseDays: feesForRTDB.creditCardBRReleaseDays },
            creditCardGlobal: { fixedFee: feesForRTDB.creditCardGlobalFixedFee, percentFee: feesForRTDB.creditCardGlobalPercentFee, releaseDays: feesForRTDB.creditCardGlobalReleaseDays },
            boleto: { fixedFee: feesForRTDB.boletoFixedFee, percentFee: feesForRTDB.boletoPercentFee, releaseDays: feesForRTDB.boletoReleaseDays },
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminName,
          };
          await globalFeeRef.set(mergedGlobal, { merge: true });
          console.log('✅ globalFeeConfig/globalConfig sincronizado via POST payment-config');
        } catch (gfcErr: any) {
          console.warn('⚠️ Sync globalFeeConfig (não crítico):', gfcErr?.message);
        }
      } catch (feeSyncErr: any) {
        console.warn('⚠️ Sync de taxas (não crítico):', feeSyncErr?.message);
      }
    }

    console.log('✅ Configurações de pagamento salvas com sucesso');
    
    res.json({
      success: true,
      message: checkoutsUpdated > 0 
        ? `Configurações salvas e aplicadas em ${checkoutsUpdated} checkouts!`
        : 'Configurações de pagamento salvas com sucesso!',
      timestamp: new Date().toISOString(),
      checkoutsUpdated,
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao salvar configurações de pagamento:', error);
    res.status(500).json({ 
      error: 'Erro ao salvar configurações de pagamento',
      details: error.message
    });
  }
});

// 🔍 STATUS DAS CONFIGURAÇÕES - ADMIN ONLY
adminConfigRouter.get('/api/admin/config/status', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const stripeConfigCache = getStripeConfigCache();
    res.json({
      success: true,
      firebase: {
        frontend_configured: !!process.env.VITE_FIREBASE_API_KEY && !!process.env.VITE_FIREBASE_PROJECT_ID,
        backend_configured: !!process.env.FIREBASE_PROJECT_ID && !!process.env.FIREBASE_CLIENT_EMAIL && !!process.env.FIREBASE_PRIVATE_KEY
      },
      ai: {
        openai_configured: !!process.env.OPENAI_API_KEY
      },
      payments: {
        stripe_configured: !!stripeConfigCache?.secretKey || !!process.env.STRIPE_SECRET_KEY,
        stripe_environment: stripeConfigCache?.environment || 
                           (process.env.STRIPE_SECRET_KEY?.includes('_live_') ? 'production' : 
                           process.env.STRIPE_SECRET_KEY?.includes('_test_') ? 'sandbox' : 'unknown'),
        stripe_source: stripeConfigCache ? 'firebase_encrypted' : 'environment',
        efibank_configured: !!process.env.EFI_CLIENT_ID && !!process.env.EFI_CLIENT_SECRET
      }
    });
    
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Erro ao verificar status',
      details: error.message
    });
  }
});

// 📋 ADMIN - LISTAR TODOS OS BANNERS
adminConfigRouter.get('/api/admin/banners', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🎨 Admin buscando todos os banners...');
    
    // Aguardar storage estar pronto
    let retries = 0;
    while (!(storage as any).db && retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }

    if (!(storage as any).db) {
      return res.json([]);
    }

    const bannersRef = (storage as any).db.collection('admin').doc('banners');
    const bannersDoc = await bannersRef.get();
    
    if (bannersDoc.exists) {
      const data = bannersDoc.data();
      const banners = data.banners || [];
      console.log(`✅ ${banners.length} banners encontrados`);
      res.json(banners);
    } else {
      console.log('📋 Nenhum banner encontrado');
      res.json([]);
    }
    
  } catch (error) {
    console.error('❌ Erro ao buscar banners:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ➕ ADMIN - CRIAR NOVO BANNER
adminConfigRouter.post('/api/admin/banners', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const bannerData = req.body;
    console.log('🎨 Admin criando novo banner:', bannerData);
    
    // Aguardar storage estar pronto
    let retries = 0;
    while (!(storage as any).db && retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }

    if (!(storage as any).db) {
      return res.status(500).json({ error: 'Database não disponível' });
    }

    const bannersRef = (storage as any).db.collection('admin').doc('banners');
    const bannersDoc = await bannersRef.get();
    
    // Buscar banners existentes ou criar array vazio
    let currentBanners = [];
    if (bannersDoc.exists) {
      const data = bannersDoc.data();
      currentBanners = data.banners || [];
    }
    
    // Criar novo banner com ID único
    const newBanner = {
      id: Date.now().toString(),
      title: bannerData.title || '',
      description: bannerData.description || '',
      imageUrl: bannerData.imageUrl || '',
      link: bannerData.link || '',
      targetBlank: bannerData.targetBlank !== false,
      position: bannerData.position || 'dashboard_top',
      isActive: bannerData.isActive !== false, // ✅ PADRONIZADO: isActive
      priority: bannerData.priority || 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Adicionar ao array
    currentBanners.push(newBanner);
    
    // Salvar no Firestore
    await bannersRef.set({ banners: currentBanners }, { merge: true });
    
    const { firestoreCache } = await import('../lib/firestore-cache.js');
    firestoreCache.invalidateBanners();
    
    console.log('✅ Banner criado com sucesso:', newBanner.id);
    res.json({ success: true, banner: newBanner });
    
  } catch (error) {
    console.error('❌ Erro ao criar banner:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ✏️ ADMIN - ATUALIZAR BANNER
adminConfigRouter.put('/api/admin/banners/:id', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    console.log(`🎨 Admin atualizando banner ${id}:`, updateData);
    
    // Aguardar storage estar pronto
    let retries = 0;
    while (!(storage as any).db && retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }

    if (!(storage as any).db) {
      return res.status(500).json({ error: 'Database não disponível' });
    }

    const bannersRef = (storage as any).db.collection('admin').doc('banners');
    const bannersDoc = await bannersRef.get();
    
    if (!bannersDoc.exists) {
      return res.status(404).json({ error: 'Banner não encontrado' });
    }
    
    const data = bannersDoc.data();
    let banners = data.banners || [];
    
    // Encontrar e atualizar banner
    const bannerIndex = banners.findIndex((b: any) => b.id === id);
    if (bannerIndex === -1) {
      return res.status(404).json({ error: 'Banner não encontrado' });
    }
    
    // Atualizar dados
    banners[bannerIndex] = {
      ...banners[bannerIndex],
      ...updateData,
      updatedAt: new Date()
    };
    
    // Salvar no Firestore
    await bannersRef.set({ banners }, { merge: true });
    
    const { firestoreCache } = await import('../lib/firestore-cache.js');
    firestoreCache.invalidateBanners();
    
    console.log('✅ Banner atualizado com sucesso:', id);
    res.json({ success: true, banner: banners[bannerIndex] });
    
  } catch (error) {
    console.error('❌ Erro ao atualizar banner:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🗑️ ADMIN - DELETAR BANNER
adminConfigRouter.delete('/api/admin/banners/:id', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    console.log(`🎨 Admin deletando banner ${id}`);
    
    // Aguardar storage estar pronto
    let retries = 0;
    while (!(storage as any).db && retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }

    if (!(storage as any).db) {
      return res.status(500).json({ error: 'Database não disponível' });
    }

    const bannersRef = (storage as any).db.collection('admin').doc('banners');
    const bannersDoc = await bannersRef.get();
    
    if (!bannersDoc.exists) {
      return res.status(404).json({ error: 'Banner não encontrado' });
    }
    
    const data = bannersDoc.data();
    let banners = data.banners || [];
    
    // Filtrar banner a ser removido
    const filteredBanners = banners.filter((b: any) => b.id !== id);
    
    if (filteredBanners.length === banners.length) {
      return res.status(404).json({ error: 'Banner não encontrado' });
    }
    
    // Salvar no Firestore
    await bannersRef.set({ banners: filteredBanners }, { merge: true });
    
    const { firestoreCache } = await import('../lib/firestore-cache.js');
    firestoreCache.invalidateBanners();
    
    console.log('✅ Banner deletado com sucesso:', id);
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Erro ao deletar banner:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🌍 PÚBLICO - BANNERS ATIVOS
adminConfigRouter.get('/api/banners/active', async (req, res) => {
  try {
    const { position } = req.query;
    console.log(`🔥 Requisição de banners recebida! Position: ${position || 'todas'}`);
    
    let retries = 0;
    while (!(storage as any).db && retries < 3) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }

    if (!(storage as any).db) {
      return res.json([]);
    }

    const { firestoreCache } = await import('../lib/firestore-cache.js');
    const cacheKey = (position as string) || '__all__';
    const cachedBanners = firestoreCache.getBannersFromCache(cacheKey);
    
    if (cachedBanners !== undefined) {
      console.log(`✅ [CACHE] ${cachedBanners.length} banners para posição ${position}`);
      return res.json(cachedBanners);
    }

    const bannersRef = (storage as any).db.collection('admin').doc('banners');
    const bannersDoc = await Promise.race([
      bannersRef.get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 5000))
    ]) as any;
    
    if (bannersDoc.exists) {
      const data = bannersDoc.data();
      let banners = data.banners || [];
      banners = banners.filter((banner: any) => banner.isActive === true || banner.active === true);
      if (position) {
        banners = banners.filter((banner: any) => banner.position === position);
      }
      firestoreCache.setBannersCache(cacheKey, banners);
      console.log(`✅ ${banners.length} banners ativos encontrados para posição ${position}`);
      res.json(banners);
    } else {
      firestoreCache.setBannersCache(cacheKey, []);
      res.json([]);
    }
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar banners ativos:', error);
    try {
      const { firestoreCache } = await import('../lib/firestore-cache.js');
      const cacheKey = (req.query.position as string) || '__all__';
      firestoreCache.setBannersCache(cacheKey, []);
    } catch (e) {}
    res.json([]);
  }
});

  return adminConfigRouter;
}
