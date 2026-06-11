/**
 * VolatusPay — Script de Teste e Auditoria Completa
 * Uso: node scripts/test-audit.mjs
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ── Carregar .env ──────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const env = readFileSync(path.join(projectRoot, '.env'), 'utf-8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([^#=\s]+)\s*=\s*([\s\S]*?)$/);
      if (m) {
        const key = m[1].trim();
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch { /* use process.env */ }
}
loadEnv();

// ── Firebase Admin ─────────────────────────────────────────────────────────
function initFirebase() {
  if (admin.apps.length > 0) return admin.apps[0];
  let credential;
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    try {
      let raw = saJson.trim();
      if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf-8');
      const parsed = JSON.parse(raw);
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      credential = admin.credential.cert(parsed);
    } catch {}
  }
  if (!credential) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    credential = admin.credential.cert({ projectId, clientEmail, privateKey });
  }
  return admin.initializeApp({ credential, databaseURL: `https://${process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com` });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log  = (icon, msg) => console.log(`${icon} ${msg}`);
const hr   = () => console.log('─'.repeat(65));

function calcFees(amountCents) {
  const gatewayFeeFixed   = 90;    // R$ 0,90
  const gatewayFeePercent = 0.01;  // 1%
  const platformFeePercent = 0.0199; // 1,99%
  const gatewayFee  = Math.round(amountCents * gatewayFeePercent) + gatewayFeeFixed;
  const platformFee = Math.round(amountCents * platformFeePercent);
  return { gatewayFee, platformFee, netAmount: amountCents - gatewayFee - platformFee };
}

const FAKE_CUSTOMERS = [
  { name: 'João Silva',       email: 'joao.silva@teste.com',       phone: '11999990001', document: '52998224725' },
  { name: 'Maria Santos',     email: 'maria.santos@teste.com',     phone: '11999990002', document: '34428700594' },
  { name: 'Carlos Oliveira',  email: 'carlos.oliveira@teste.com',  phone: '11999990003', document: '49019134891' },
  { name: 'Ana Costa',        email: 'ana.costa@teste.com',        phone: '11999990004', document: '45738611390' },
];

async function main() {
  initFirebase();
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  hr();
  log('🚀', 'AUDITORIA E TESTE COMPLETO — VolatusPay');
  hr();

  // ── 1. Encontrar teste@gmail.com ───────────────────────────────────────
  log('👤', 'Buscando teste@gmail.com...');
  let sellerUid;
  try {
    const u = await admin.auth().getUserByEmail('teste@gmail.com');
    sellerUid = u.uid;
    log('✅', `UID: ${sellerUid}`);
  } catch (e) {
    log('❌', `Usuário não encontrado: ${e.message}`);
    process.exit(1);
  }

  // ── 2. Buscar todos os checkouts ───────────────────────────────────────
  log('📦', 'Buscando checkouts...');
  const ckSnap = await db.collection('checkouts').where('tenantId', '==', sellerUid).limit(50).get();
  const checkouts = ckSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  log('📦', `${checkouts.length} checkouts encontrados`);

  // Também buscar na coleção de produtos para ter mais info
  const prodSnap = await db.collection('products').where('tenantId', '==', sellerUid).limit(50).get();
  const products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  log('📦', `${products.length} produtos encontrados`);
  for (const p of products) log('  📌', `Produto: ${p.id} | tipo: ${p.productType || p.type || '?'} | título: ${p.title || p.name || '?'}`);

  // Encontrar ou criar checkouts por tipo
  const findCheckout = (type) => checkouts.find(c =>
    c.productType === type || c.type === type ||
    c.checkoutType === type || c.productKind === type
  );

  const BUGS = [];

  async function ensureCheckout(type, label, price) {
    let ck = findCheckout(type);
    if (ck) {
      log('✅', `Checkout ${label} existente: ${ck.id} — R$ ${((ck.price || ck.amount || price)/100).toFixed(2)}`);
      return ck;
    }
    // Criar checkout de teste
    const ckId = `ck_test_${type}_${Date.now()}`;
    const ckData = {
      id: ckId,
      tenantId: sellerUid,
      sellerId: sellerUid,
      productType: type,
      type,
      title: `[TESTE] ${label}`,
      price,
      amount: price,
      currency: 'BRL',
      active: true,
      isTest: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      slug: ckId,
      ...(type === 'subscription' ? { subscriptionPeriod: 'mensal' } : {}),
    };
    await db.collection('checkouts').doc(ckId).set(ckData);
    log('🆕', `Checkout ${label} criado para teste: ${ckId}`);
    return ckData;
  }

  const physicalCk      = await ensureCheckout('physical',     'Produto Físico',  7990); // R$ 79,90
  const digitalCk       = findCheckout('digital') || checkouts[0] || await ensureCheckout('digital', 'Produto Digital', 4990);
  const subscriptionCk  = await ensureCheckout('subscription', 'Assinatura',      2990); // R$ 29,90

  log('📦', `  Físico:     ${physicalCk.id} — R$ ${((physicalCk.price||physicalCk.amount||7990)/100).toFixed(2)}`);
  log('📦', `  Digital:    ${digitalCk.id}  — R$ ${((digitalCk.price||digitalCk.amount||4990)/100).toFixed(2)}`);
  log('📦', `  Assinatura: ${subscriptionCk.id} — R$ ${((subscriptionCk.price||subscriptionCk.amount||2990)/100).toFixed(2)}`);

  // ── 3. Criar 4 orders de cada tipo ────────────────────────────────────
  hr();
  log('💳', 'FASE 1: Criando 4 orders de cada tipo');
  hr();

  const createdOrders = [];
  let totalNetAmount = 0;

  async function createOrders(checkout, type, label) {
    const price = checkout.price || checkout.amount || 4990;
    log('💳', `[${label}] — R$ ${(price/100).toFixed(2)} × 4`);

    for (let i = 0; i < 4; i++) {
      const customer = FAKE_CUSTOMERS[i];
      const fees = calcFees(price);
      const orderId = `test_${type}_${Date.now()}_${i}`;
      const createdAt = new Date(Date.now() - (4 - i) * 3600000);
      const releaseDate = new Date(Date.now() + 2 * 86400000);

      const orderData = {
        tenantId: sellerUid, sellerId: sellerUid,
        checkoutId: checkout.id, checkoutSlug: checkout.slug || checkout.id,
        productId: checkout.productId || checkout.id,
        productName: checkout.title || label,
        productType: type,
        customerName: customer.name, customerEmail: customer.email,
        customerPhone: customer.phone, customerDocument: customer.document,
        customer: { name: customer.name, email: customer.email, phone: customer.phone, document: customer.document },
        ...(type === 'physical' ? {
          customerAddress: { zipCode: '01310-100', street: 'Av. Paulista', number: `${100+i}`, city: 'São Paulo', state: 'SP' },
          address: { zipCode: '01310-100', street: 'Av. Paulista', number: `${100+i}`, city: 'São Paulo', state: 'SP' },
          shippingStatus: 'pago',
        } : {}),
        ...(type === 'subscription' ? {
          subscriptionPeriod: 'mensal', subscriptionStatus: 'active',
          nextBillingDate: new Date(Date.now() + 30 * 86400000),
        } : {}),
        status: 'paid', method: 'pix', processor: 'efibank',
        amount: price, currency: 'BRL',
        netAmount: fees.netAmount, gatewayFee: fees.gatewayFee, platformFee: fees.platformFee,
        txid: `testtxid_${orderId}`,
        financial: { released: true, netAmount: fees.netAmount, gatewayFee: fees.gatewayFee, platformFee: fees.platformFee, releaseDate, releaseDays: 2, balanceType: 'available', cardBalanceReleased: true },
        financialData: { totalAmount: price, netAmount: fees.netAmount, gatewayFee: fees.gatewayFee, platformFee: fees.platformFee, releaseDate, paidAt: createdAt, releaseDays: 2 },
        createdAt, paidAt: createdAt, updatedAt: createdAt,
        isTestOrder: true, confirmedVia: 'test_script',
      };

      try {
        await db.collection('orders').doc(orderId).set(orderData);
        createdOrders.push({ orderId, type, amount: price, netAmount: fees.netAmount, customer });
        totalNetAmount += fees.netAmount;
        log('✅', `  ${orderId} — ${customer.name} — R$ ${(price/100).toFixed(2)} (líq: R$ ${(fees.netAmount/100).toFixed(2)})`);
      } catch (e) {
        log('❌', `  Falha: ${e.message}`);
        BUGS.push({ bug: `BUG-ORDER-${type}`, severity: 'HIGH', desc: `Falha ao criar order ${type}: ${e.message}` });
      }
      await sleep(80);
    }
  }

  await createOrders(physicalCk,     'physical',     'Produto Físico');
  await createOrders(digitalCk,      'digital',      'Produto Digital');
  await createOrders(subscriptionCk, 'subscription', 'Assinatura');

  log('📊', `Total orders criadas: ${createdOrders.length} | Líquido: R$ ${(totalNetAmount/100).toFixed(2)}`);

  // ── 4. Atualizar saldo ─────────────────────────────────────────────────
  hr();
  log('💰', 'FASE 2: Atualizando saldo no Firestore');
  hr();

  const balRef = db.collection('sellerBalances').doc(sellerUid);
  try {
    const balSnap = await balRef.get();
    const ex = balSnap.exists ? balSnap.data() : {};
    const prev = ex.balanceAvailable_BRL || 0;
    const newBal = prev + totalNetAmount;
    await balRef.set({
      sellerId: sellerUid,
      balanceAvailable_BRL: newBal, available_BRL: newBal,
      balancePending_BRL: ex.balancePending_BRL || 0, pending_BRL: 0,
      balanceReserved_BRL: 0, reserved_BRL: 0,
      lifetimeRevenue_BRL: (ex.lifetimeRevenue_BRL || 0) + totalNetAmount,
      available: newBal, availableBalance: newBal, totalBalance: newBal,
      updatedAt: FieldValue.serverTimestamp(), currency: 'BRL',
    }, { merge: true });
    log('✅', `Saldo: R$ ${(prev/100).toFixed(2)} → R$ ${(newBal/100).toFixed(2)} (+R$ ${(totalNetAmount/100).toFixed(2)})`);
  } catch (e) {
    log('❌', `Erro saldo: ${e.message}`);
    BUGS.push({ bug: 'BUG-BALANCE', severity: 'HIGH', desc: `Falha ao atualizar saldo: ${e.message}` });
  }

  // ── 5. Gerar token e testar APIs ───────────────────────────────────────
  hr();
  log('🔍', 'FASE 3: Testes de API (http://localhost:80)');
  hr();

  let idToken = null;
  try {
    const customToken = await admin.auth().createCustomToken(sellerUid);
    const apiKey = process.env.VITE_FIREBASE_API_KEY;
    if (apiKey) {
      const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      });
      const d = await r.json();
      idToken = d.idToken;
      log('✅', 'ID token obtido');
    }
  } catch (e) { log('⚠️', `Token: ${e.message}`); }

  const apiTests = [];

  async function callApi(path, method = 'GET', body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    try {
      const resp = await fetch(`http://localhost:80${path}`, opts);
      const text = await resp.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.substring(0, 200) }; }
      return { status: resp.status, ok: resp.ok, data: json };
    } catch (e) { return { status: 0, ok: false, error: e.message }; }
  }

  if (idToken) {
    // Orders
    const ordersR = await callApi(`/api/orders?tenantId=${sellerUid}&limit=50`);
    apiTests.push({ test: 'GET /api/orders', ...ordersR });
    const ordersArr = ordersR.data?.data || ordersR.data?.orders || (Array.isArray(ordersR.data) ? ordersR.data : []);
    const paidCount = ordersArr.filter ? ordersArr.filter(o => o.status === 'paid').length : '?';
    log(ordersR.ok ? '✅' : '❌', `GET /api/orders → ${ordersR.status} — ${paidCount} pagas`);
    if (!ordersR.ok) BUGS.push({ bug: 'BUG-API-ORDERS', severity: 'HIGH', desc: `GET /api/orders: ${ordersR.status} — ${JSON.stringify(ordersR.data).substring(0,100)}` });

    // Balance — campo correto é available_BRL no response
    const balR = await callApi(`/api/balance/summary?tenantId=${sellerUid}`);
    apiTests.push({ test: 'GET /api/balance/summary', ...balR });
    if (balR.ok) {
      const bal = balR.data;
      const avail = bal?.totals?.BRL?.available || bal?.available_BRL || bal?.balanceAvailable_BRL || 0;
      const pend  = bal?.totals?.BRL?.pending  || bal?.pending_BRL  || bal?.balancePending_BRL  || 0;
      log('✅', `GET /api/balance/summary → ${balR.status}`);
      log('💰', `  PIX disponível: R$ ${(avail/100).toFixed(2)} | Pendente: R$ ${(pend/100).toFixed(2)}`);
    } else {
      log('❌', `GET /api/balance/summary → ${balR.status}`);
      BUGS.push({ bug: 'BUG-BALANCE-API', severity: 'HIGH', desc: `balance/summary: ${balR.status} — ${JSON.stringify(balR.data).substring(0,100)}` });
    }

    // Checkouts
    const ckR = await callApi(`/api/checkouts?tenantId=${sellerUid}&limit=20`);
    apiTests.push({ test: 'GET /api/checkouts', ...ckR });
    log(ckR.ok ? '✅' : '❌', `GET /api/checkouts → ${ckR.status} — ${(ckR.data?.checkouts || ckR.data || []).length || 0} checkouts`);

    // Physical orders
    const physR = await callApi('/api/physical-orders?limit=20');
    apiTests.push({ test: 'GET /api/physical-orders', ...physR });
    const physCount = physR.data?.orders?.length || physR.data?.length || 0;
    log(physR.ok ? '✅' : '❌', `GET /api/physical-orders → ${physR.status} — ${physCount} pedidos físicos`);
    if (!physR.ok) BUGS.push({ bug: 'BUG-PHYSICAL-ORDERS', severity: 'MEDIUM', desc: `physical-orders: ${physR.status} — ${JSON.stringify(physR.data).substring(0,100)}` });

    // Subscriptions
    const subR = await callApi(`/api/subscriptions?tenantId=${sellerUid}&limit=20`);
    apiTests.push({ test: 'GET /api/subscriptions', ...subR });
    const subCount = subR.data?.subscriptions?.length || subR.data?.length || 0;
    log(subR.ok ? '✅' : '❌', `GET /api/subscriptions → ${subR.status} — ${subCount} assinaturas`);

    // Webhooks
    const whR = await callApi(`/api/integrations/webhooks`);
    apiTests.push({ test: 'GET /api/integrations/webhooks', ...whR });
    log(whR.ok ? '✅' : '❌', `GET /api/integrations/webhooks → ${whR.status} — ${whR.data?.webhooks?.length || 0} webhooks`);

    // API keys
    const akListR = await callApi('/api/integrations/api-keys');
    apiTests.push({ test: 'GET /api/integrations/api-keys', ...akListR });
    log(akListR.ok ? '✅' : '❌', `GET /api/integrations/api-keys → ${akListR.status}`);

    // ✅ TESTE DO BUG CORRIGIDO: POST api-keys com permissions
    await sleep(500); // aguardar servidor reiniciar completamente
    const akCreateR = await callApi('/api/integrations/api-keys', 'POST', {
      name: 'Chave Automação Script', permissions: ['orders:read', 'products:read', 'webhooks:write']
    });
    apiTests.push({ test: 'POST /api/integrations/api-keys (permissions)', ...akCreateR });
    if (akCreateR.ok) {
      log('✅', `POST /api/integrations/api-keys → ${akCreateR.status} — chave: ${(akCreateR.data?.apiKey||'').substring(0,20)}...`);
    } else {
      log('❌', `POST /api/integrations/api-keys → ${akCreateR.status} — ${JSON.stringify(akCreateR.data).substring(0,120)}`);
      BUGS.push({ bug: 'BUG-API-KEY-CREATE', severity: 'CRITICAL', desc: `Criar API key falhou: ${akCreateR.status} — ${JSON.stringify(akCreateR.data).substring(0,100)}` });
    }

    // POST webhook
    const whCreateR = await callApi('/api/integrations/webhooks', 'POST', {
      url: 'https://webhook.site/volatuspay-test', events: ['payment.paid', 'payment.pending', 'subscription.renewed'], secret: 'script-test-secret'
    });
    apiTests.push({ test: 'POST /api/integrations/webhooks', ...whCreateR });
    log(whCreateR.ok ? '✅' : '❌', `POST /api/integrations/webhooks → ${whCreateR.status} — ${JSON.stringify(whCreateR.data).substring(0,80)}`);
    if (!whCreateR.ok) BUGS.push({ bug: 'BUG-WEBHOOK-CREATE', severity: 'HIGH', desc: `Criar webhook: ${whCreateR.status} — ${JSON.stringify(whCreateR.data).substring(0,100)}` });

    // Produtos
    const prodR = await callApi(`/api/products?tenantId=${sellerUid}&limit=20`);
    apiTests.push({ test: 'GET /api/products', ...prodR });
    const prodList = prodR.data?.products || prodR.data || [];
    log(prodR.ok ? '✅' : '❌', `GET /api/products → ${prodR.status} — ${Array.isArray(prodList) ? prodList.length : '?'} produtos`);

    // Teste de endpoint de ofertas de produto
    const offerR = await callApi('/api/products/product_Insc7zt79fNPW1Nkhk2YN/offers', 'GET');
    apiTests.push({ test: 'GET /api/products/:id/offers', ...offerR });
    log(offerR.ok ? '✅' : '❌', `GET /api/products/.../offers → ${offerR.status}`);

    // Dashboard / métricas de vendas por categoria
    const metricsR = await callApi(`/api/orders?tenantId=${sellerUid}&limit=100`);
    if (metricsR.ok) {
      const orders = metricsR.data?.data || metricsR.data?.orders || (Array.isArray(metricsR.data) ? metricsR.data : []);
      const byType = {};
      let totalGross = 0; let totalNet = 0;
      for (const o of orders) {
        if (o.status !== 'paid') continue;
        const t = o.productType || 'outro';
        byType[t] = (byType[t] || 0) + 1;
        totalGross += o.amount || 0;
        totalNet += o.netAmount || 0;
      }
      log('📊', `Categorias de vendas pagas:`);
      for (const [t, cnt] of Object.entries(byType)) log('  📌', `  ${t}: ${cnt} vendas`);
      log('💰', `  Bruto total: R$ ${(totalGross/100).toFixed(2)} | Líquido: R$ ${(totalNet/100).toFixed(2)}`);
    }
  } else {
    log('⚠️', 'Sem token — pulando testes de API autenticada');
    BUGS.push({ bug: 'BUG-TOKEN', severity: 'HIGH', desc: 'Não foi possível gerar ID token para teste' });
  }

  // ── 6. Verificação direta Firestore ───────────────────────────────────
  hr();
  log('🔍', 'FASE 4: Verificação no Firestore');
  hr();

  const ordSnap = await db.collection('orders').where('tenantId', '==', sellerUid).where('status', '==', 'paid').get();
  const byType = {}; let firestoreNet = 0;
  for (const doc of ordSnap.docs) {
    const d = doc.data();
    const t = d.productType || 'outro';
    byType[t] = (byType[t] || 0) + 1;
    firestoreNet += d.netAmount || 0;
  }
  log('📊', `Orders paid no Firestore: ${ordSnap.size}`);
  log('📊', `  ${Object.entries(byType).map(([t,c])=>`${t}:${c}`).join(' | ')}`);
  log('💰', `  Receita líquida total: R$ ${(firestoreNet/100).toFixed(2)}`);

  const finalBal = await db.collection('sellerBalances').doc(sellerUid).get();
  if (finalBal.exists) {
    const b = finalBal.data();
    log('💰', `sellerBalances disponível: R$ ${((b.balanceAvailable_BRL||b.available_BRL||0)/100).toFixed(2)}`);
  } else {
    BUGS.push({ bug: 'BUG-BAL-DOC', severity: 'HIGH', desc: 'sellerBalances doc não existe' });
  }

  const wSnap = await db.collection('webhooks').where('sellerId', '==', sellerUid).get();
  log('🔗', `Webhooks no Firestore: ${wSnap.size}`);

  const akSnap = await db.collection('apiKeys').where('sellerId', '==', sellerUid).get();
  log('🔑', `API keys no Firestore: ${akSnap.size}`);

  // ── 7. Relatório ───────────────────────────────────────────────────────
  hr();
  log('🐛', `RELATÓRIO DE BUGS: ${BUGS.length} encontrados`);
  hr();

  if (BUGS.length === 0) {
    log('🎉', 'NENHUM BUG! Tudo OK.');
  } else {
    for (const b of BUGS) {
      log(b.severity === 'CRITICAL' ? '🔴🔴' : b.severity === 'HIGH' ? '🔴' : '🟡', `[${b.bug}][${b.severity}] ${b.desc}`);
    }
  }

  hr();
  log('📋', 'SUMÁRIO');
  hr();
  log('📦', `Orders criadas: ${createdOrders.length} (físico:${createdOrders.filter(o=>o.type==='physical').length} digital:${createdOrders.filter(o=>o.type==='digital').length} assin:${createdOrders.filter(o=>o.type==='subscription').length})`);
  log('💰', `Bruto injetado: R$ ${(createdOrders.reduce((s,o)=>s+o.amount,0)/100).toFixed(2)} | Líquido: R$ ${(totalNetAmount/100).toFixed(2)}`);
  log('🔗', `API tests: ${apiTests.filter(t=>t.ok).length}/${apiTests.length} OK`);
  log('🐛', `Bugs: ${BUGS.length}`);
  hr();

  if (BUGS.length > 0) {
    console.log('\n📋 BUGS PARA CORRIGIR:');
    console.log(JSON.stringify(BUGS, null, 2));
  }

  process.exit(BUGS.length > 0 ? 1 : 0);
}

main().catch(e => { console.error('❌ FATAL:', e); process.exit(1); });
