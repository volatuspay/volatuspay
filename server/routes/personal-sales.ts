import { Router } from 'express';
import { verifyFirebaseToken } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';
import { storage } from '../storage.js';
import { createWooviCharge } from '../lib/woovi-api.js';
import { getPaymentConfig, getEfiBankKeys } from '../lib/payment-config.js';
import crypto from 'crypto';

const router = Router();

function generatePersonalSaleId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(6).toString('hex');
  return `ps_${timestamp}_${random}`;
}

router.post('/generate-pix', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { productName, amount, description, productId, offerName } = req.body;

    if (!productName || typeof productName !== 'string' || productName.trim().length < 2) {
      return res.status(400).json({ error: 'Nome do produto é obrigatório (mínimo 2 caracteres)' });
    }

    const finalOfferName = offerName?.trim() || productName.trim();

    if (finalOfferName.length < 2) {
      return res.status(400).json({ error: 'Nome da oferta é obrigatório (mínimo 2 caracteres)' });
    }

    if (!amount || typeof amount !== 'number' || amount < 100) {
      return res.status(400).json({ error: 'Valor mínimo é R$ 1,00 (100 centavos)' });
    }

    if (amount > 100000000) {
      return res.status(400).json({ error: 'Valor máximo é R$ 1.000.000,00' });
    }

    const saleId = generatePersonalSaleId();
    const tenantId = user.uid;

    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) {
      return res.status(500).json({ error: 'Firebase não conectado' });
    }

    const db = firebaseStorage.db;
    const paymentConfig = await getPaymentConfig(db);
    const selectedGateway = paymentConfig?.defaultAcquirers?.pix || 'woovi';

    console.log(`💰 [PERSONAL-SALE] Gerando PIX: ${saleId} | Produto: ${productName} | Valor: R$ ${(amount / 100).toFixed(2)} | Gateway: ${selectedGateway}`);

    let pixResult: { qrcodeText: string; qrcodeImage: string | null; txid: string; expiresAt: string } | null = null;

    if (selectedGateway === 'woovi') {
      const wooviResponse = await createWooviCharge({
        correlationID: saleId,
        value: amount,
        comment: `${productName} - Venda Personalizada`,
      });

      if (!wooviResponse || !wooviResponse.charge) {
        return res.status(502).json({ error: 'Falha ao gerar cobrança PIX via Woovi. Verifique as configurações do adquirente.' });
      }

      pixResult = {
        qrcodeText: wooviResponse.charge.brCode,
        qrcodeImage: wooviResponse.charge.qrCodeImage || null,
        txid: wooviResponse.charge.identifier,
        expiresAt: wooviResponse.charge.expiresDate || new Date(Date.now() + 3600000).toISOString(),
      };
    } else {
      const efiBankKeys = await getEfiBankKeys(db);

      if (!efiBankKeys || !efiBankKeys.clientId || !efiBankKeys.clientSecret) {
        return res.status(502).json({ error: 'Credenciais EfíBank não configuradas. Configure em Admin > Adquirentes.' });
      }

      const isProduction = efiBankKeys.environment === 'production';
      const hostname = isProduction ? 'pix.api.efipay.com.br' : 'pix-h.api.efipay.com.br';

      let token: string;
      try {
        const https = await import('https');
        const fs = await import('fs');
        const path = await import('path');

        let certBuffer: Buffer | null = null;

        try {
          const { getAdmin } = await import('../lib/firebase-admin.js');
          const adminSdk = getAdmin();
          const rtdb = adminSdk.database();
          const certSnap = await rtdb.ref('system/certificates/efibank-prod').once('value');
          const certData = certSnap.val();
          if (certData?.base64) {
            certBuffer = Buffer.from(certData.base64, 'base64');
            console.log(`✅ [PERSONAL-SALE] Certificado do RTDB: ${certBuffer.length} bytes`);
          }
        } catch (e) {
          console.warn('⚠️ [PERSONAL-SALE] RTDB cert falhou, tentando local...');
        }

        if (!certBuffer) {
          const certPath = path.join(process.cwd(), 'certs', 'efi-prod.p12');
          if (fs.existsSync(certPath)) {
            certBuffer = fs.readFileSync(certPath);
            console.log(`✅ [PERSONAL-SALE] Certificado local: ${certBuffer.length} bytes`);
          }
        }

        if (!certBuffer && isProduction) {
          return res.status(502).json({ error: 'Certificado P12 não encontrado. Faça upload no painel admin.' });
        }

        const authString = Buffer.from(`${efiBankKeys.clientId}:${efiBankKeys.clientSecret}`).toString('base64');

        const httpsAgent = certBuffer ? new https.Agent({
          pfx: certBuffer,
          passphrase: '',
          rejectUnauthorized: true,
          keepAlive: false,
        }) : undefined;

        const oauthHostname = isProduction ? 'pix.api.efipay.com.br' : 'pix-h.api.efipay.com.br';
        const postData = JSON.stringify({ grant_type: 'client_credentials' });

        const tokenResult: any = await new Promise((resolve, reject) => {
          const options: any = {
            hostname: oauthHostname,
            port: 443,
            path: '/oauth/token',
            method: 'POST',
            headers: {
              'Authorization': `Basic ${authString}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            },
          };

          if (httpsAgent) {
            options.agent = httpsAgent;
          }

          const req = https.request(options, (response) => {
            let data = '';
            response.on('data', (chunk: string) => data += chunk);
            response.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch {
                reject(new Error('Erro ao parsear token EfíBank'));
              }
            });
          });
          req.on('error', reject);
          req.setTimeout(15000, () => { req.destroy(); reject(new Error('OAuth2 timeout')); });
          req.write(postData);
          req.end();
        });

        if (!tokenResult.access_token) {
          console.error('❌ [PERSONAL-SALE] Token EfíBank falhou:', JSON.stringify(tokenResult));
          return res.status(502).json({ error: `Falha ao gerar PIX via EfíBank: EfíBank PIX error ${tokenResult.error || 'unknown'}: ${tokenResult.error_description || JSON.stringify(tokenResult)}` });
        }

        token = tokenResult.access_token;
        console.log('✅ [PERSONAL-SALE] Token OAuth2 obtido com sucesso');

        const pixKey = paymentConfig?.efibank?.pixKey || process.env.EFIBANK_PIX_KEY || '';

        if (!pixKey) {
          return res.status(502).json({ error: 'Chave PIX não configurada. Configure a chave PIX do EfíBank em Admin > Adquirentes, ou use Woovi como alternativa.' });
        }

        const pixPayload = {
          calendario: { expiracao: 3600 },
          valor: { original: (amount / 100).toFixed(2) },
          chave: pixKey,
          solicitacaoPagador: `${productName} - Venda Personalizada`,
        };

        const pixResponse: any = await new Promise((resolve, reject) => {
          const options: any = {
            hostname,
            port: 443,
            path: '/v2/cob',
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          };

          if (httpsAgent) {
            options.agent = httpsAgent;
          }

          const req = https.request(options, (response) => {
            let data = '';
            response.on('data', (chunk: string) => data += chunk);
            response.on('end', () => {
              try {
                const result = JSON.parse(data);
                if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                  resolve(result);
                } else {
                  reject(new Error(`EfíBank PIX error ${response.statusCode}: ${JSON.stringify(result)}`));
                }
              } catch {
                reject(new Error(`Erro ao parsear resposta PIX`));
              }
            });
          });
          req.on('error', reject);
          req.setTimeout(15000, () => { req.destroy(); reject(new Error('PIX creation timeout')); });
          req.write(JSON.stringify(pixPayload));
          req.end();
        });

        const txid = pixResponse.txid;

        let qrCodeResponse: any = null;
        if (pixResponse.loc?.id) {
          try {
            qrCodeResponse = await new Promise((resolve, reject) => {
              const options: any = {
                hostname,
                port: 443,
                path: `/v2/loc/${pixResponse.loc.id}/qrcode`,
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` },
              };

              if (certBuffer) {
                options.pfx = certBuffer;
                options.passphrase = '';
              }

              const req = https.request(options, (response) => {
                let data = '';
                response.on('data', (chunk: string) => data += chunk);
                response.on('end', () => {
                  try {
                    resolve(JSON.parse(data));
                  } catch {
                    reject(new Error('Erro ao parsear QR Code'));
                  }
                });
              });
              req.on('error', reject);
              req.end();
            });
          } catch (qrErr) {
            console.warn('⚠️ [PERSONAL-SALE] Erro ao buscar QR Code da EfíBank:', qrErr);
          }
        }

        let qrImage = qrCodeResponse?.imagemQrcode || qrCodeResponse?.image || qrCodeResponse?.qr_code_image || null;
        const qrCodeText = qrCodeResponse?.qrcode || pixResponse.pixCopiaECola || '';

        if (!qrImage && qrCodeText) {
          try {
            const QRCode = await import('qrcode');
            qrImage = await QRCode.toDataURL(qrCodeText, {
              errorCorrectionLevel: 'M',
              type: 'image/png',
              width: 300,
              margin: 1,
            });
          } catch (qrErr) {
            console.warn('⚠️ [PERSONAL-SALE] Erro ao gerar QR Code local:', qrErr);
          }
        }

        pixResult = {
          qrcodeText: qrCodeText,
          qrcodeImage: qrImage,
          txid: txid,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        };
      } catch (efiError: any) {
        console.error('❌ [PERSONAL-SALE] Erro EfíBank:', efiError.message);
        return res.status(502).json({ error: `Falha ao gerar PIX via EfíBank: ${efiError.message}` });
      }
    }

    if (!pixResult) {
      return res.status(502).json({ error: 'Falha ao gerar cobrança PIX' });
    }

    const saleData: any = {
      id: saleId,
      tenantId,
      productName: productName.trim(),
      offerName: finalOfferName,
      description: description?.trim() || '',
      amount,
      status: 'pending',
      method: 'pix',
      gateway: selectedGateway,
      txid: pixResult.txid,
      qrcodeText: pixResult.qrcodeText,
      type: 'personal_sale',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: pixResult.expiresAt,
    };

    if (productId) {
      saleData.productId = productId;
    }

    await firebaseStorage.db.collection('personalSales').doc(saleId).set(saleData);

    const orderData: any = {
      tenantId,
      sellerId: tenantId,
      amount,
      status: 'pending',
      method: 'pix',
      gateway: selectedGateway,
      txid: pixResult.txid,
      type: 'personal_sale',
      saleType: 'pix_qrcode',
      personalSaleId: saleId,
      customer: { name: 'Venda QR Code PIX', email: '' },
      checkoutSnapshot: {
        title: productName.trim(),
        productName: productName.trim(),
        offerName: finalOfferName,
      },
      productName: productName.trim(),
      offerName: finalOfferName,
      description: description?.trim() || '',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: pixResult.expiresAt,
    };

    if (productId) {
      orderData.productId = productId;
    }

    await firebaseStorage.db.collection('orders').doc(saleId).set(orderData);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('../lib/neon-financial.js').then(({ neonWriteOrder }) => {
      neonWriteOrder({
        id: saleId,
        tenantId: orderData.sellerId,
        sellerId: orderData.sellerId,
        productId: orderData.productId ?? null,
        status: orderData.status,
        method: orderData.method,
        paymentMethod: 'efibank_pix',
        paymentProcessor: 'efibank',
        amount: orderData.amount,
        currency: 'BRL',
        customer: orderData.customer,
        checkoutSnapshot: orderData.checkoutSnapshot,
        metadata: { saleType: orderData.saleType, personalSaleId: saleId },
      });
    }).catch(() => {});

    console.log(`✅ [PERSONAL-SALE] PIX gerado com sucesso: ${saleId} | TXID: ${pixResult.txid} | Order criada para webhook`);

    res.json({
      success: true,
      saleId,
      txid: pixResult.txid,
      qrcode: {
        text: pixResult.qrcodeText,
        image: pixResult.qrcodeImage,
      },
      expiresAt: pixResult.expiresAt,
      amount,
      productName: productName.trim(),
    });
  } catch (error: any) {
    console.error('❌ [PERSONAL-SALE] Erro geral:', error.message);
    res.status(500).json({ error: 'Erro interno ao gerar PIX' });
  }
});

router.get('/check-status/:saleId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const { saleId } = req.params;
    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) return res.status(500).json({ error: 'Firebase não conectado' });

    const doc = await firebaseStorage.db.collection('personalSales').doc(saleId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Venda não encontrada' });

    const sale = doc.data();
    const isAdmin = user.customClaims?.admin === true;
    if (!isAdmin && sale.tenantId !== user.uid) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    let finalStatus = sale.status;
    let finalPaidAt = sale.paidAt || null;

    if (finalStatus === 'pending') {
      const orderDoc = await firebaseStorage.db.collection('orders').doc(saleId).get();
      if (orderDoc.exists) {
        const orderData = orderDoc.data();
        if (orderData.status === 'paid') {
          finalStatus = 'paid';
          finalPaidAt = orderData.paidAt || new Date();
          await firebaseStorage.db.collection('personalSales').doc(saleId).update({
            status: 'paid',
            paidAt: finalPaidAt,
            updatedAt: new Date(),
            qrcodeText: '',
            qrExpired: true,
          });
        }
      }
    }

    res.json({ status: finalStatus, saleId, paidAt: finalPaidAt });
  } catch (error: any) {
    console.error('❌ [PERSONAL-SALE] Erro ao verificar status:', error.message);
    res.status(500).json({ error: 'Erro ao verificar status' });
  }
});

router.post('/mark-paid/:saleId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const isAdmin = user.customClaims?.admin === true;
    if (!isAdmin) {
      return res.status(403).json({ error: 'Acesso negado - apenas administradores podem marcar vendas como pagas manualmente' });
    }

    const { saleId } = req.params;
    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) return res.status(500).json({ error: 'Firebase não conectado' });

    const docRef = firebaseStorage.db.collection('personalSales').doc(saleId);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Venda não encontrada' });

    const sale = doc.data();

    if (sale.status === 'paid') {
      return res.status(409).json({ error: 'Venda já está marcada como paga' });
    }

    await docRef.update({
      status: 'paid',
      paidAt: new Date(),
      updatedAt: new Date(),
      markedPaidBy: user.uid,
      qrcodeText: '',
      qrExpired: true,
    });

    const orderRef = firebaseStorage.db.collection('orders').doc(saleId);
    const orderDoc = await orderRef.get();
    if (orderDoc.exists) {
      await orderRef.update({
        status: 'paid',
        paidAt: new Date(),
        updatedAt: new Date(),
        markedPaidBy: user.uid,
      });
    }

    try {
      const { calculateDynamicFees } = await import('../index.js');
      const { processWebhookWithBalanceUpdate } = await import('../lib/atomic-balance.js');

      let netAmountCents = sale.amount;

      if (typeof calculateDynamicFees === 'function') {
        const feeCalc = await calculateDynamicFees(sale.amount, 'pix', 1, sale.gateway || 'efibank');
        netAmountCents = Math.round(feeCalc.netAmount);

        if (orderDoc.exists) {
          await orderRef.update({
            netAmount: feeCalc.netAmount,
            gatewayFee: feeCalc.gatewayFee,
            platformFee: feeCalc.platformFee,
            financialData: {
              grossAmount: sale.amount,
              netAmount: feeCalc.netAmount,
              gatewayFee: feeCalc.gatewayFee,
              platformFee: feeCalc.platformFee,
            },
          });
        }
      }

      const webhookId = `personal_sale_manual_${saleId}_${Date.now()}`;
      const balanceResult = await processWebhookWithBalanceUpdate({
        webhookId,
        provider: sale.gateway === 'woovi' ? 'woovi' : 'efibank',
        eventType: 'pix.paid',
        sellerId: sale.tenantId,
        amountCents: netAmountCents,
        currency: 'BRL',
        operation: 'add',
        balanceType: 'available',
        reason: `Venda QR Code PIX manual - ${saleId}`,
        orderId: saleId,
        metadata: {
          method: 'pix',
          acquirer: sale.gateway || 'efibank',
          totalAmount: sale.amount,
          saleType: 'pix_qrcode',
        },
      });

      if (balanceResult.processed) {
        console.log(`💰 [PERSONAL-SALE] Saldo creditado: R$ ${(netAmountCents / 100).toFixed(2)}`);
      } else {
        console.log(`⚠️ [PERSONAL-SALE] Balance já processado: ${balanceResult.reason}`);
      }
    } catch (balanceError: any) {
      console.error('⚠️ [PERSONAL-SALE] Erro ao creditar saldo (mark-paid):', balanceError?.message);
    }

    console.log(`✅ [PERSONAL-SALE] Venda ${saleId} marcada como paga por ${user.uid}`);

    res.json({ success: true, saleId, status: 'paid' });
  } catch (error: any) {
    console.error('❌ [PERSONAL-SALE] Erro ao marcar como pago:', error.message);
    res.status(500).json({ error: 'Erro ao marcar como pago' });
  }
});

router.get('/', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const { limit: queryLimit, cursor } = req.query;
    const tenantId = user.uid;
    const isAdmin = user.customClaims?.admin === true;
    const limit = Math.min(parseInt(queryLimit as string) || 50, 500);

    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) return res.status(500).json({ error: 'Firebase não conectado' });

    let query = firebaseStorage.db
      .collection('personalSales')
      .where('tenantId', '==', tenantId)
      .limit(500);

    const snapshot = await query.get();
    const allDocs = snapshot.docs.sort((a: any, b: any) => {
      const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt || 0;
      const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt || 0;
      return bTime - aTime;
    });
    const hasMore = allDocs.length > limit;
    const docs = allDocs.slice(0, limit);
    const nextCursor = hasMore ? docs[docs.length - 1].id : null;

    const sales = docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        productName: data.productName,
        offerName: data.offerName || data.productName,
        description: data.description || '',
        amount: data.amount,
        status: data.status,
        method: data.method,
        gateway: data.gateway,
        txid: data.txid,
        createdAt: data.createdAt,
        paidAt: data.paidAt || null,
        expiresAt: data.expiresAt,
        productId: data.productId || null,
      };
    });

    res.json({
      data: sales,
      pagination: { hasMore, nextCursor, limit, count: sales.length },
    });
  } catch (error: any) {
    console.error('❌ [PERSONAL-SALE] Erro ao listar vendas:', error.message);
    res.status(500).json({ error: 'Erro ao listar vendas personalizadas' });
  }
});

export default router;
