import { getFirestore, ensureFirebaseReady } from '../lib/firebase-admin.js';
import { saveDataToBunny, saveDataBatchToBunny, DataCategory } from '../lib/bunny-data-storage.js';

const COLLECTIONS_TO_BACKFILL: Array<{
  collection: string;
  category: DataCategory;
  idField?: string;
  tenantField?: string;
  dateField?: string;
}> = [
  { collection: 'securityLogs', category: 'logs/security', idField: 'id', dateField: 'timestamp' },
  { collection: 'auditLogs', category: 'logs/audit', idField: 'id', dateField: 'timestamp' },
  { collection: 'payment-audit-logs', category: 'logs/payment-audit', idField: 'eventId', dateField: 'timestamp' },
  { collection: 'checkoutEvents', category: 'analytics/checkout-events', tenantField: 'tenantId', dateField: 'createdAt' },
  { collection: 'webhookLogs', category: 'logs/webhook', dateField: 'timestamp' },
  { collection: 'utmifyLogs', category: 'logs/utmify', tenantField: 'tenantId', dateField: 'sentAt' },
  { collection: 'rateLimitViolations', category: 'logs/rate-limit', dateField: 'timestamp' },
];

function parseDate(value: any): Date | undefined {
  if (!value) return undefined;

  if (value._seconds !== undefined) {
    return new Date(value._seconds * 1000);
  }

  if (value.toDate && typeof value.toDate === 'function') {
    return value.toDate();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }

  return undefined;
}

async function backfillCollection(
  db: FirebaseFirestore.Firestore,
  config: (typeof COLLECTIONS_TO_BACKFILL)[number]
): Promise<{ total: number; saved: number; errors: number }> {
  const { collection, category, idField, tenantField, dateField } = config;
  let total = 0;
  let saved = 0;
  let errors = 0;

  console.log(`\n📂 Iniciando backfill: ${collection} -> ${category}`);

  try {
    let query: FirebaseFirestore.Query = db.collection(collection).orderBy('__name__');
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let hasMore = true;

    while (hasMore) {
      let batch: FirebaseFirestore.Query = query.limit(100);
      if (lastDoc) {
        batch = batch.startAfter(lastDoc);
      }

      const snapshot = await batch.get();

      if (snapshot.empty || snapshot.docs.length === 0) {
        hasMore = false;
        break;
      }

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const docId = idField && data[idField] ? String(data[idField]) : doc.id;
        const date = dateField ? parseDate(data[dateField]) : undefined;
        const tenantId = tenantField ? data[tenantField] : undefined;

        try {
          const result = await saveDataToBunny(category, docId, data, {
            tenantId,
            date,
          });

          if (result.success) {
            saved++;
          } else {
            errors++;
            if (errors <= 5) {
              console.warn(`  ⚠️ Erro ao salvar doc ${docId}: ${result.error}`);
            }
          }
        } catch (err: any) {
          errors++;
          if (errors <= 5) {
            console.error(`  ❌ Exceção ao salvar doc ${docId}: ${err.message}`);
          }
        }

        total++;
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      if (total % 100 === 0) {
        console.log(`  📊 Progresso [${collection}]: ${total} docs processados | ✅ ${saved} salvos | ❌ ${errors} erros`);
      }

      if (snapshot.docs.length < 100) {
        hasMore = false;
      }
    }
  } catch (err: any) {
    console.error(`❌ Erro fatal ao ler collection ${collection}: ${err.message}`);
  }

  console.log(`✅ Concluído [${collection}]: ${total} total | ${saved} salvos | ${errors} erros`);
  return { total, saved, errors };
}

async function main() {
  console.log('🚀 Backfill Firestore -> Bunny CDN Storage');
  console.log('='.repeat(60));

  const collectionFilter = (() => {
    const idx = process.argv.indexOf('--collection');
    if (idx !== -1 && process.argv[idx + 1]) {
      return process.argv[idx + 1];
    }
    return null;
  })();

  if (collectionFilter) {
    console.log(`🔍 Filtro ativo: apenas collection "${collectionFilter}"`);
  }

  console.log('\n🔥 Inicializando Firebase Admin...');
  await ensureFirebaseReady();
  const db = getFirestore();
  console.log('✅ Firebase pronto!\n');

  const collectionsToProcess = collectionFilter
    ? COLLECTIONS_TO_BACKFILL.filter(c => c.collection === collectionFilter)
    : COLLECTIONS_TO_BACKFILL;

  if (collectionsToProcess.length === 0) {
    console.error(`❌ Collection "${collectionFilter}" não encontrada na lista de backfill.`);
    console.log('📋 Collections disponíveis:', COLLECTIONS_TO_BACKFILL.map(c => c.collection).join(', '));
    process.exit(1);
  }

  const summary: Array<{ collection: string; total: number; saved: number; errors: number }> = [];

  for (const config of collectionsToProcess) {
    const result = await backfillCollection(db, config);
    summary.push({ collection: config.collection, ...result });
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMO FINAL DO BACKFILL');
  console.log('='.repeat(60));

  let grandTotal = 0;
  let grandSaved = 0;
  let grandErrors = 0;

  for (const s of summary) {
    console.log(`  📂 ${s.collection}: ${s.total} total | ✅ ${s.saved} salvos | ❌ ${s.errors} erros`);
    grandTotal += s.total;
    grandSaved += s.saved;
    grandErrors += s.errors;
  }

  console.log('-'.repeat(60));
  console.log(`  🏁 TOTAL: ${grandTotal} docs | ✅ ${grandSaved} salvos | ❌ ${grandErrors} erros`);
  console.log('='.repeat(60));

  if (grandErrors > 0) {
    console.log('\n⚠️ Alguns documentos falharam. Execute novamente para tentar novamente (o script é idempotente).');
  } else {
    console.log('\n🎉 Backfill concluído com sucesso!');
  }
}

main().catch((err) => {
  console.error('❌ Erro fatal no backfill:', err);
  process.exit(1);
});
