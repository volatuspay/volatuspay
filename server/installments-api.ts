// 🛡️ SECURITY: CÁLCULO SEGURO DE PARCELAS NO BACKEND
// Dados de parcelas JAMAIS devem ser calculados no frontend!
// ✅ CORRIGIDO: Lê taxas REAIS do admin/acquirers-config no Firestore

import express from 'express';
import { getFirestore } from 'firebase-admin/firestore';

const router = express.Router();

interface InstallmentRequest {
  amount: number;
  paymentMethod: 'efibank' | 'stripe';
  checkoutId?: string;
}

interface InstallmentOption {
  value: number;
  label: string;
  fee: number;
  totalAmount: number;
  amountPerInstallment: number;
  withdrawalDays?: number;
}

// Taxas padrão — usadas apenas se o Firestore não tiver configuração
const DEFAULT_FEES = {
  efibank: {
    installment1x: 5.2,
    installment2to6x: 6.2,
    installment7to9x: 8.2,
    installment10to12x: 9.2,
    withdrawalDays1x: 20,
    withdrawalDays2to6x: 25,
    withdrawalDays7to9x: 30,
    withdrawalDays10to12x: 30,
  },
  stripe: {
    installment1x: 5.2,
    installment2to6x: 7.2,
    installment7to9x: 8.2,
    installment10to12x: 9.2,
    withdrawalDays1x: 30,
    withdrawalDays2to6x: 30,
    withdrawalDays7to9x: 30,
    withdrawalDays10to12x: 30,
  },
};

async function getAcquirerFees(paymentMethod: 'efibank' | 'stripe'): Promise<typeof DEFAULT_FEES['efibank']> {
  try {
    const db = getFirestore();
    const configDoc = await db.collection('admin').doc('acquirers-config').get();
    if (configDoc.exists) {
      const data = configDoc.data() as any;
      const cfg = data?.[paymentMethod];
      if (cfg && (cfg.installment1x || cfg.cardFeePercent)) {
        const base = cfg.installment1x || cfg.cardFeePercent || DEFAULT_FEES[paymentMethod].installment1x;
        return {
          installment1x:      cfg.installment1x      ?? base,
          installment2to6x:   cfg.installment2to6x   ?? cfg.installment6x  ?? base,
          installment7to9x:   cfg.installment7to9x   ?? cfg.installment9x  ?? base,
          installment10to12x: cfg.installment10to12x ?? cfg.installment12x ?? base,
          withdrawalDays1x:      cfg.withdrawalDays1x      ?? cfg.withdrawalDays ?? DEFAULT_FEES[paymentMethod].withdrawalDays1x,
          withdrawalDays2to6x:   cfg.withdrawalDays2to6x   ?? cfg.withdrawalDays ?? DEFAULT_FEES[paymentMethod].withdrawalDays2to6x,
          withdrawalDays7to9x:   cfg.withdrawalDays7to9x   ?? cfg.withdrawalDays ?? DEFAULT_FEES[paymentMethod].withdrawalDays7to9x,
          withdrawalDays10to12x: cfg.withdrawalDays10to12x ?? cfg.withdrawalDays ?? DEFAULT_FEES[paymentMethod].withdrawalDays10to12x,
        };
      }
    }
  } catch (e: any) {
    console.warn('[INSTALLMENTS] Falha ao ler admin/acquirers-config, usando padrão:', e?.message);
  }
  return DEFAULT_FEES[paymentMethod];
}

// 🔐 ENDPOINT SEGURO PARA CÁLCULO DE PARCELAS
router.post('/api/calculate-installments', async (req, res) => {
  try {
    const { amount, paymentMethod }: InstallmentRequest = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valor inválido', code: 'INVALID_AMOUNT' });
    }

    if (!paymentMethod || !['efibank', 'stripe'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Método de pagamento inválido', code: 'INVALID_PAYMENT_METHOD' });
    }

    // ✅ LEITURA REAL DO ADMIN CONFIG
    const feeConfig = await getAcquirerFees(paymentMethod);
    console.log(`🔐 [INSTALLMENTS] Taxas carregadas do admin (${paymentMethod}):`, feeConfig);

    const installmentOptions: InstallmentOption[] = [];

    // 💳 1x
    installmentOptions.push({
      value: 1,
      label: `1x de ${(amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (à vista)`,
      fee: feeConfig.installment1x,
      totalAmount: Math.round(amount * (1 + feeConfig.installment1x / 100)),
      amountPerInstallment: Math.round(amount * (1 + feeConfig.installment1x / 100)),
      withdrawalDays: feeConfig.withdrawalDays1x,
    });

    // 💳 2x a 6x
    for (let i = 2; i <= 6; i++) {
      const totalWithFee = Math.round(amount * (1 + feeConfig.installment2to6x / 100));
      const amountPerInstallment = Math.round(totalWithFee / i);
      installmentOptions.push({
        value: i,
        label: `${i}x de ${(amountPerInstallment / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        fee: feeConfig.installment2to6x,
        totalAmount: totalWithFee,
        amountPerInstallment,
        withdrawalDays: feeConfig.withdrawalDays2to6x,
      });
    }

    // 💳 7x a 9x
    for (let i = 7; i <= 9; i++) {
      const totalWithFee = Math.round(amount * (1 + feeConfig.installment7to9x / 100));
      const amountPerInstallment = Math.round(totalWithFee / i);
      installmentOptions.push({
        value: i,
        label: `${i}x de ${(amountPerInstallment / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        fee: feeConfig.installment7to9x,
        totalAmount: totalWithFee,
        amountPerInstallment,
        withdrawalDays: feeConfig.withdrawalDays7to9x,
      });
    }

    // 💳 10x a 12x
    for (let i = 10; i <= 12; i++) {
      const totalWithFee = Math.round(amount * (1 + feeConfig.installment10to12x / 100));
      const amountPerInstallment = Math.round(totalWithFee / i);
      installmentOptions.push({
        value: i,
        label: `${i}x de ${(amountPerInstallment / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        fee: feeConfig.installment10to12x,
        totalAmount: totalWithFee,
        amountPerInstallment,
        withdrawalDays: feeConfig.withdrawalDays10to12x,
      });
    }

    console.log(`✅ [INSTALLMENTS] Calculadas ${installmentOptions.length} opções de parcelamento para ${paymentMethod}`);

    res.json({
      success: true,
      installmentOptions,
      fees: feeConfig,
    });

  } catch (error) {
    console.error('❌ ERRO NO CÁLCULO SEGURO DE PARCELAS:', error);
    res.status(500).json({ error: 'Erro interno no cálculo de parcelas', code: 'CALCULATION_ERROR' });
  }
});

export default router;
