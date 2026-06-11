import { Router, json as expressJson } from 'express';
import {
  verifyFirebaseToken,
  requireAdmin,
  AuthenticatedRequest
} from '../security/firebase-auth.js';
import { ensureFirebaseReady, getFirestore } from '../lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

const sellerCompaniesRouter = Router();
sellerCompaniesRouter.use(expressJson({ limit: '50kb' }));

// GET /api/seller/companies — retorna apenas a empresa principal do seller
sellerCompaniesRouter.get('/api/seller/companies', verifyFirebaseToken, async (req: AuthenticatedRequest, res: any) => {
  try {
    await ensureFirebaseReady();
    const db = getFirestore();
    const sellerId = req.user!.uid;

    const sellerDoc = await db.collection('sellers').doc(sellerId).get();
    const sellerData = sellerDoc.data() || {};

    const rawDoc = (sellerData.cnpj || sellerData.document || sellerData.cpf || '').replace(/\D/g, '');
    const companies = [{
      id: 'main',
      sellerId,
      businessName: sellerData.businessName || sellerData.companyName || sellerData.name || sellerData.fullName || 'Empresa Principal',
      legalName: sellerData.name || sellerData.fullName || null,
      document: rawDoc,
      documentType: rawDoc.length === 14 ? 'cnpj' : 'cpf',
      status: 'approved',
      isMain: true,
    }];

    res.json({ companies });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/company-approvals — listagem para o admin (sellers pendentes)
sellerCompaniesRouter.get('/api/admin/company-approvals', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: any) => {
  try {
    await ensureFirebaseReady();
    const db = getFirestore();

    const status = (req.query.status as string) || 'pending';
    let q: any = db.collection('sellers');
    if (status !== 'all') q = q.where('status', '==', status);

    const snap = await q.get();
    const companies: any[] = [];

    for (const doc of snap.docs) {
      const d = doc.data();
      companies.push({
        id: doc.id,
        sellerId: doc.id,
        businessName: d.businessName || d.companyName || d.name || '',
        email: d.email || '',
        document: d.cnpj || d.document || d.cpf || '',
        status: d.status || 'pending',
        createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
        reviewedAt: d.reviewedAt?.toDate?.()?.toISOString() || null,
      });
    }

    res.json({ companies });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/company-approvals/:id — aprovar/rejeitar seller
sellerCompaniesRouter.put('/api/admin/company-approvals/:id', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: any) => {
  try {
    await ensureFirebaseReady();
    const db = getFirestore();

    const { id } = req.params;
    const { status, reason } = req.body;

    if (!['approved', 'rejected', 'blocked'].includes(status)) {
      return res.status(400).json({ error: 'status deve ser approved, rejected ou blocked' });
    }

    await db.collection('sellers').doc(id).update({
      status,
      reviewReason: reason || null,
      reviewedAt: FieldValue.serverTimestamp(),
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default sellerCompaniesRouter;
