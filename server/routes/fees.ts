import { Router } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { 
  DEFAULT_FEES, 
  globalFeeConfigSchema,
  sellerFeeOverrideSchema,
  acquirerFeeConfigSchema,
  type GlobalFeeConfig, 
  type SellerFeeOverride 
} from '../../shared/schema.js';
import { z } from 'zod';
import { syncGlobalFeesToRTDB, syncSellerFeesToRTDB, syncWithdrawalConfigToRTDB } from '../lib/eternal-sync.js';
import { firestoreCache, withFirestoreTimeout } from '../lib/firestore-cache.js';
import { verifyFirebaseToken, requireAdmin, checkAdminAccess } from '../security/firebase-auth.js';

const router = Router();

const partialAcquirerFeeSchema = z.object({
  percentageFee: z.number().min(0).max(100).optional(),
  fixedFeeCents: z.number().int().min(0).optional(),
  releaseDays: z.number().int().min(0).max(90).optional(),
  anticipationFeePercent: z.number().min(0).max(100).optional(),
  updatedAt: z.date().optional(),
  updatedBy: z.string().optional(),
}).strict().partial();

const updateGlobalFeesSchema = z.object({
  pix: partialAcquirerFeeSchema.optional(),
  creditCardBR_D30: partialAcquirerFeeSchema.optional(),
  creditCardBR_D20: partialAcquirerFeeSchema.optional(),
  creditCardBR_default: z.enum(['D30', 'D20']).optional(),
  creditCardGlobal: partialAcquirerFeeSchema.optional(),
  boleto: partialAcquirerFeeSchema.optional(),
  stripe: partialAcquirerFeeSchema.optional(),
  efibank: partialAcquirerFeeSchema.optional(),
  adyen: partialAcquirerFeeSchema.optional(),
  woovi: partialAcquirerFeeSchema.optional(),
  pagarme: partialAcquirerFeeSchema.optional(),
  witetec: partialAcquirerFeeSchema.optional(),
  updatedBy: z.string().optional(),
}).strict();

function normalizeTimestamps(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const normalized: any = Array.isArray(obj) ? [] : {};
  
  for (const key in obj) {
    const value = obj[key];
    
    if (value && typeof value === 'object') {
      if (typeof value.toDate === 'function') {
        normalized[key] = value.toDate();
      } else {
        normalized[key] = normalizeTimestamps(value);
      }
    } else {
      normalized[key] = value;
    }
  }
  
  return normalized;
}

router.get('/fees/global', async (req, res) => {
  try {
    const cachedFees = firestoreCache.getGlobalFeeConfigFromCache('globalConfig');
    if (cachedFees) {
      return res.json(cachedFees);
    }

    const db = getFirestore();
    const globalFeeDoc = await db.collection('globalFeeConfig').doc('globalConfig').get();
    
    if (!globalFeeDoc.exists) {
      const newConfig = {
        ...DEFAULT_FEES,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      await db.collection('globalFeeConfig').doc('globalConfig').set(newConfig);
      
      const bootstrapDoc = await db.collection('globalFeeConfig').doc('globalConfig').get();
      const rawBootstrap = bootstrapDoc.data();
      const normalizedBootstrap = normalizeTimestamps(rawBootstrap);
      
      const bootstrapParseResult = globalFeeConfigSchema.safeParse(normalizedBootstrap);
      
      if (!bootstrapParseResult.success) {
        console.error('Erro de validação - bootstrap de taxas falhou:', bootstrapParseResult.error);
        return res.status(500).json({ 
          error: 'Falha ao criar configuração inicial de taxas',
          details: bootstrapParseResult.error.format()
        });
      }
      
      firestoreCache.setGlobalFeeConfigCache('globalConfig', bootstrapParseResult.data);
      return res.json(bootstrapParseResult.data);
    }
    
    const rawData = globalFeeDoc.data();
    const normalizedData = normalizeTimestamps(rawData);
    
    const parseResult = globalFeeConfigSchema.safeParse(normalizedData);
    
    if (!parseResult.success) {
      console.error('Erro de validação - dados globais corrompidos:', parseResult.error);
      return res.status(500).json({ 
        error: 'Dados de taxas globais corrompidos',
        details: parseResult.error.format()
      });
    }
    
    firestoreCache.setGlobalFeeConfigCache('globalConfig', parseResult.data);
    return res.json(parseResult.data);
  } catch (error) {
    console.error('Erro ao buscar taxas globais:', error);
    return res.status(500).json({ error: 'Falha ao buscar taxas globais' });
  }
});

router.get('/fees/seller/:sellerId', async (req, res) => {
  try {
    const db = getFirestore();
    const { sellerId } = req.params;
    
    const sellerFeeDoc = await db.collection('sellerFeeOverrides').doc(sellerId).get();
    
    if (!sellerFeeDoc.exists) {
      return res.status(404).json({ message: 'Seller não possui taxas personalizadas' });
    }
    
    const rawData = sellerFeeDoc.data();
    const normalizedData = normalizeTimestamps(rawData);
    
    const parseResult = sellerFeeOverrideSchema.safeParse(normalizedData);
    
    if (!parseResult.success) {
      console.error('Erro de validação - dados do seller corrompidos:', parseResult.error);
      return res.status(500).json({ 
        error: 'Dados de taxas do seller corrompidos',
        details: parseResult.error.format()
      });
    }
    
    return res.json(parseResult.data);
  } catch (error) {
    console.error('Erro ao buscar taxas do seller:', error);
    return res.status(500).json({ error: 'Falha ao buscar taxas do seller' });
  }
});

router.put('/fees/seller/:sellerId/anticipation', verifyFirebaseToken, async (req: any, res) => {
  try {
    const db = getFirestore();
    const { sellerId } = req.params;
    const { anticipation } = req.body;
    
    // Verificar se o usuário autenticado é o próprio seller ou um admin
    const requestingUid = req.user?.uid;
    if (requestingUid !== sellerId) {
      const isAdmin = await checkAdminAccess(requestingUid);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
    }
    
    // Apenas D30 (padrão) ou D20 (antecipação) — corresponde ao schema sellerFeeOverrideSchema
    if (!anticipation || !['D30', 'D20'].includes(anticipation)) {
      return res.status(400).json({ error: 'Antecipação inválida. Use D30 (padrão) ou D20 (antecipado).' });
    }
    
    const sellerFeeRef = db.collection('sellerFeeOverrides').doc(sellerId);
    const sellerFeeDoc = await sellerFeeRef.get();
    
    if (!sellerFeeDoc.exists) {
      await sellerFeeRef.set({
        id: sellerId,
        sellerId: sellerId,
        creditCardBR_selected: anticipation,
        defaultAnticipation: anticipation,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await sellerFeeRef.set({
        ...sellerFeeDoc.data(),
        creditCardBR_selected: anticipation,
        defaultAnticipation: anticipation,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    
    const updatedSellerDoc = await sellerFeeRef.get();
    if (updatedSellerDoc.exists) {
      syncSellerFeesToRTDB(sellerId, updatedSellerDoc.data() as Record<string, any>).catch(err =>
        console.error(`⚠️ [ETERNAL-SYNC] Erro async seller ${sellerId}:`, err?.message)
      );
    }
    
    return res.json({ 
      success: true, 
      anticipation,
      message: 'Preferência de antecipação atualizada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao atualizar antecipação:', error);
    return res.status(500).json({ error: 'Falha ao atualizar preferência de antecipação' });
  }
});

router.put('/fees/global', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const db = getFirestore();
    const parseResult = updateGlobalFeesSchema.safeParse(req.body);
    
    if (!parseResult.success) {
      console.error('Erro de validação:', parseResult.error);
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: parseResult.error.issues 
      });
    }
    
    const updates = parseResult.data;
    const globalFeeRef = db.collection('globalFeeConfig').doc('globalConfig');
    
    const currentDoc = await globalFeeRef.get();
    const currentData = currentDoc.exists ? currentDoc.data() : DEFAULT_FEES;
    
    const mergedData: any = {
      ...currentData,
      ...updates,
      id: 'globalConfig',
      updatedAt: FieldValue.serverTimestamp(),
    };
    
    if (!currentDoc.exists) {
      mergedData.createdAt = FieldValue.serverTimestamp();
    }
    
    await globalFeeRef.set(mergedData, { merge: true });
    
    firestoreCache.invalidateGlobalFeeConfig();
    
    const updatedDoc = await globalFeeRef.get();
    const rawData = updatedDoc.data();
    const normalizedData = normalizeTimestamps(rawData);
    
    const validationResult = globalFeeConfigSchema.safeParse(normalizedData);
    
    if (!validationResult.success) {
      console.error('Erro de validação após atualização:', validationResult.error);
      return res.status(500).json({ 
        error: 'Dados atualizados corrompidos',
        details: validationResult.error.format()
      });
    }
    
    syncGlobalFeesToRTDB(validationResult.data, updates.updatedBy).catch(err =>
      console.error('⚠️ [ETERNAL-SYNC] Erro async taxas globais:', err?.message)
    );
    
    const withdrawalDays: Record<string, any> = {};
    if (validationResult.data.pix?.releaseDays !== undefined) withdrawalDays.pixReleaseDays = validationResult.data.pix.releaseDays;
    if (validationResult.data.creditCardBR_D30?.releaseDays !== undefined) withdrawalDays.creditCardBRReleaseDays = validationResult.data.creditCardBR_D30.releaseDays;
    if (validationResult.data.creditCardGlobal?.releaseDays !== undefined) withdrawalDays.creditCardGlobalReleaseDays = validationResult.data.creditCardGlobal.releaseDays;
    if (validationResult.data.boleto?.releaseDays !== undefined) withdrawalDays.boletoReleaseDays = validationResult.data.boleto.releaseDays;
    if (Object.keys(withdrawalDays).length > 0) {
      syncWithdrawalConfigToRTDB(withdrawalDays).catch(err =>
        console.error('⚠️ [ETERNAL-SYNC] Erro async prazos:', err?.message)
      );
    }

    // 🔄 SYNC BIDIRECIONAL: Atualizar paymentConfig/global.fees com as novas taxas
    // Garante que o cálculo de taxas em pagamentos PIX/Cartão/Boleto use os valores corretos
    const d = validationResult.data;
    const paymentConfigFees: Record<string, any> = {};
    if (d.pix) {
      if (d.pix.fixedFeeCents !== undefined) paymentConfigFees.pixFixedFee = d.pix.fixedFeeCents;
      if (d.pix.percentageFee !== undefined) paymentConfigFees.pixPercentFee = d.pix.percentageFee;
      if (d.pix.releaseDays !== undefined) paymentConfigFees.pixReleaseDays = d.pix.releaseDays;
    }
    if (d.creditCardBR_D30) {
      if (d.creditCardBR_D30.fixedFeeCents !== undefined) paymentConfigFees.creditCardBRFixedFee = d.creditCardBR_D30.fixedFeeCents;
      if (d.creditCardBR_D30.percentageFee !== undefined) paymentConfigFees.creditCardBRPercentFee = d.creditCardBR_D30.percentageFee;
      if (d.creditCardBR_D30.releaseDays !== undefined) paymentConfigFees.creditCardBRReleaseDays = d.creditCardBR_D30.releaseDays;
    }
    if (d.creditCardGlobal) {
      if (d.creditCardGlobal.fixedFeeCents !== undefined) paymentConfigFees.creditCardGlobalFixedFee = d.creditCardGlobal.fixedFeeCents;
      if (d.creditCardGlobal.percentageFee !== undefined) paymentConfigFees.creditCardGlobalPercentFee = d.creditCardGlobal.percentageFee;
      if (d.creditCardGlobal.releaseDays !== undefined) paymentConfigFees.creditCardGlobalReleaseDays = d.creditCardGlobal.releaseDays;
    }
    if (d.boleto) {
      if (d.boleto.fixedFeeCents !== undefined) paymentConfigFees.boletoFixedFee = d.boleto.fixedFeeCents;
      if (d.boleto.percentageFee !== undefined) paymentConfigFees.boletoPercentFee = d.boleto.percentageFee;
      if (d.boleto.releaseDays !== undefined) paymentConfigFees.boletoReleaseDays = d.boleto.releaseDays;
    }
    if (Object.keys(paymentConfigFees).length > 0) {
      db.collection('paymentConfig').doc('global').set(
        { fees: paymentConfigFees, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      ).then(() => {
        console.log('✅ [FEES] paymentConfig/global.fees sincronizado com novas taxas');
        try { firestoreCache.invalidatePaymentConfig(); } catch (_) {}
        import('../lib/neon-payment.js').then(({ neonUpdatePaymentConfig }) => {
          neonUpdatePaymentConfig('global', { fees: paymentConfigFees });
        }).catch(() => {});
      }).catch(err =>
        console.error('⚠️ [FEES] Erro ao sincronizar paymentConfig/global.fees:', err?.message)
      );
    }
    
    return res.json({ 
      success: true, 
      message: 'Taxas globais atualizadas com sucesso',
      data: validationResult.data
    });
  } catch (error) {
    console.error('Erro ao atualizar taxas globais:', error);
    return res.status(500).json({ error: 'Falha ao atualizar taxas globais' });
  }
});

export default router;
