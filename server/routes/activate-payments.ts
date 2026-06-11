/**
 * 🚀 ENDPOINT PARA ATIVAÇÃO AUTOMÁTICA DE PAGAMENTOS
 * Rota administrativa para ativar todas as integrações de pagamento
 */

import { Router } from 'express';
import { getFirestore } from '../lib/firebase-admin.js';
import { encryptSensitiveData } from '../security/key-encryption.js';
import admin from 'firebase-admin';

const router = Router();

router.post('/api/admin/activate-payments', async (req, res) => {
  try {
    console.log('🚀 Ativando configurações de pagamento...');
    
    const db = getFirestore();
    
    // Buscar secrets do ambiente
    const secrets = {
      stripePublic: process.env.STRIPE_PUBLISHABLE_KEY,
      stripeSecret: process.env.STRIPE_SECRET_KEY,
      efibankClientId: process.env.EFIBANK_CLIENT_ID,
      efibankClientSecret: process.env.EFIBANK_CLIENT_SECRET,
      efibankPayeeCode: process.env.EFIBANK_PAYEE_CODE,
      efibankPixKey: process.env.EFIBANK_PIX_KEY,
    };
    
    // Validar
    const missing: string[] = [];
    Object.entries(secrets).forEach(([key, value]) => {
      if (!value) missing.push(key);
    });
    
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Secrets faltando: ${missing.join(', ')}`,
        missing
      });
    }
    
    // Preparar configuração
    const paymentConfig = {
      id: 'global',
      defaultAcquirers: {
        pix: 'efibank',
        creditCard: 'stripe',
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
        environment: 'production',
        publicKey: secrets.stripePublic,
        secretKey: encryptSensitiveData(secrets.stripeSecret!),
        webhookSecret: undefined,
      },
      efibank: {
        enabled: true,
        environment: 'production',
        productionClientId: encryptSensitiveData(secrets.efibankClientId!),
        productionClientSecret: encryptSensitiveData(secrets.efibankClientSecret!),
        sandboxClientId: undefined,
        sandboxClientSecret: undefined,
        payeeCode: secrets.efibankPayeeCode,
        pixKey: secrets.efibankPixKey,
        certificatePath: '/home/runner/workspace/certs/efi-prod.p12',
      },
      adyen: {
        enabled: false,
        environment: 'test',
        apiKey: undefined,
        merchantAccount: '',
        clientKey: '',
      },
      witetec: {
        enabled: false,
        environment: 'sandbox',
        apiKey: undefined,
        webhookUrl: undefined,
      },
      updatedBy: 'system-activation',
      updatedByName: 'Ativação Automática',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    // Salvar no Firebase
    await db.collection('paymentConfig').doc('global').set(paymentConfig, { merge: true });

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('../lib/neon-payment.js').then(({ neonUpsertPaymentConfig }) => {
      neonUpsertPaymentConfig({
        id: 'global',
        defaultAcquirers: (paymentConfig as any).defaultAcquirers,
        fees: (paymentConfig as any).fees,
        updatedBy: 'system-activation',
        createdAt: new Date(),
      });
    }).catch(() => {});

    console.log('✅ Configurações de pagamento ativadas!');
    
    res.json({
      success: true,
      message: 'Configurações de pagamento ativadas com sucesso!',
      summary: {
        stripe: 'ATIVO (Produção)',
        efibank: 'ATIVO (Produção)',
        adyen: 'DESABILITADO',
        witetec: 'DESABILITADO',
      }
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao ativar pagamentos:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;
