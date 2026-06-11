import express from 'express';
import { ensureFirebaseReady, getAdmin } from './firebase-singleton.js';

const app = express();

app.get('/sync-product-titles-now', async (req, res) => {
  try {
    console.log('🔄 SYNC INICIADO');
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    const productsSnap = await db.collection('products')
      .where('active', '==', true)
      .get();
    
    let totalUpdated = 0;
    const results: any[] = [];
    
    for (const pDoc of productsSnap.docs) {
      const pData = pDoc.data();
      const title = pData.title;
      
      if (!title) continue;
      
      const checkoutsSnap = await db.collection('checkouts')
        .where('syncedProductId', '==', pDoc.id)
        .get();
      
      if (checkoutsSnap.empty) continue;
      
      const batch = db.batch();
      checkoutsSnap.forEach(c => {
        batch.update(c.ref, { productTitle: title });
      });
      
      await batch.commit();
      totalUpdated += checkoutsSnap.size;
      
      results.push({ product: title, checkouts: checkoutsSnap.size });
    }
    
    res.json({ success: true, totalUpdated, results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(5001, () => console.log('Sync server on :5001'));
