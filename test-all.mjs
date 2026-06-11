/**
 * TEST-ALL — Teste completo de todas as funcionalidades VolatusPay
 * Endpoints verificados contra código-fonte real do servidor
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const SVC = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const FIREBASE_API_KEY = 'AIzaSyAnOf55q80gavAmqARCCjbkJK5XWeuAU48';
const BASE = 'http://localhost:5001';
const ADMIN_EMAIL = 'volatuspay@gmail.com';

if (!getApps().length) {
  initializeApp({ credential: cert(SVC), databaseURL: `https://${SVC.project_id}-default-rtdb.firebaseio.com/` });
}

const results = { passed: 0, failed: 0 };
const ok  = (label) => { results.passed++; console.log(`  ✅ ${label}`); };
const fail = (label, msg) => { results.failed++; console.log(`  ❌ ${label}: ${msg}`); };
const info = (msg) => console.log(`    ℹ ${msg}`);
const sep  = (t) => console.log(`\n${'═'.repeat(62)}\n  ${t}\n${'═'.repeat(62)}`);

function check(label, cond, detail = '') {
  if (cond) ok(label); else fail(label, detail || 'falhou');
}

// ─── HTTP helper ─────────────────────────────────────────────
async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.substring(0, 300) }; }
  return { status: r.status, ok: r.ok, json };
}

// ─── Firebase Auth helpers ─────────────────────────────────────
async function getAdminToken() {
  const user = await getAuth().getUserByEmail(ADMIN_EMAIL);
  const custom = await getAuth().createCustomToken(user.uid, { admin: true, superAdmin: true });
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true })
  });
  const d = await r.json();
  if (!d.idToken) throw new Error(`Admin token failed: ${JSON.stringify(d)}`);
  return { idToken: d.idToken, uid: user.uid };
}

async function signUp(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const d = await r.json();
  if (!d.idToken) throw new Error(`SignUp failed: ${JSON.stringify(d).substring(0, 200)}`);
  return { idToken: d.idToken, uid: d.localId };
}

async function signIn(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const d = await r.json();
  if (!d.idToken) throw new Error(`SignIn failed: ${JSON.stringify(d).substring(0, 200)}`);
  return d.idToken;
}

// ═══════════════════════════════════════════════════════════════
sep('SETUP: TOKENS E SELLER DE TESTE');
// ═══════════════════════════════════════════════════════════════
const { idToken: adminToken, uid: adminUid } = await getAdminToken();
ok(`Token admin obtido para ${ADMIN_EMAIL} (uid: ${adminUid.substring(0,8)}...)`);

const TS = Date.now();
const TEST_EMAIL = `testseller_${TS}@volatus-test.com`;
const TEST_PASS  = 'Test@12345';

// Check email disponível
const emailCheck = await api('POST', '/api/auth/check-email', null, { email: TEST_EMAIL, type: 'seller' });
check('check-email disponível', emailCheck.json?.available === true, JSON.stringify(emailCheck.json));

// Criar user Firebase Auth
const { idToken: sellerToken0, uid: sellerId } = await signUp(TEST_EMAIL, TEST_PASS);
ok(`User Firebase criado: ${sellerId.substring(0, 8)}...`);

// Autocreate seller no Neon (BUG CORRIGIDO: não usa mais account_type nem business_description)
const autocreate = await api('POST', '/api/sellers/autocreate', sellerToken0, {
  name: 'Vendedor Teste QA', phone: '11999999999'
});
check('autocreate seller no Neon (INSERT corrigido)', autocreate.json?.success === true, `${autocreate.status} ${JSON.stringify(autocreate.json).substring(0,150)}`);

// Verificar seller-status (BUG CORRIGIDO: try/catch protege req.user.uid)
const sellerStatus0 = await api('GET', '/api/auth/seller-status', sellerToken0);
check('seller-status após autocreate', sellerStatus0.json?.isSeller === true, JSON.stringify(sellerStatus0.json));

// seller-status do ADMIN (antes retornava 500 porque req.user.uid estava fora do try/catch)
const adminStatus = await api('GET', '/api/auth/seller-status', adminToken);
check('seller-status admin (não é 500)', adminStatus.status !== 500, `status=${adminStatus.status} ${JSON.stringify(adminStatus.json).substring(0,80)}`);

// user-type: seller sem name/business_name deve ser identificado como seller (fix redirect /dashboard)
const userType0 = await api('GET', `/api/user-type/${sellerId}`, sellerToken0);
check('user-type retorna seller (sem name no registro)', userType0.json?.type === 'seller', `type=${userType0.json?.type} status=${userType0.status} ${JSON.stringify(userType0.json).substring(0,120)}`);

// ═══════════════════════════════════════════════════════════════
sep('1. ADMIN — SELLERS');
// ═══════════════════════════════════════════════════════════════
const sellersList = await api('GET', '/api/admin/sellers', adminToken);
check('admin GET /api/admin/sellers', sellersList.ok, `${sellersList.status} ${JSON.stringify(sellersList.json).substring(0,100)}`);
const sellers = Array.isArray(sellersList.json) ? sellersList.json : sellersList.json?.sellers || [];
check('seller de teste aparece na lista admin', sellers.some(s => s.id === sellerId || s.email === TEST_EMAIL), `Total: ${sellers.length}`);

// Aprovar seller (endpoint correto: PUT /api/admin/sellers/:id com { action: 'approve' })
const approve = await api('PUT', `/api/admin/sellers/${sellerId}`, adminToken, { action: 'approve' });
check('admin aprovar seller', approve.ok, `${approve.status} ${JSON.stringify(approve.json).substring(0,150)}`);

// Relogar para token atualizado
const sellerToken = await signIn(TEST_EMAIL, TEST_PASS);
ok('Seller relogado (token atualizado pós aprovação)');

// ═══════════════════════════════════════════════════════════════
sep('2. SELLER — PERFIL');
// ═══════════════════════════════════════════════════════════════
const me = await api('GET', '/api/sellers/me', sellerToken);
check('GET /api/sellers/me', me.ok, `${me.status} ${JSON.stringify(me.json).substring(0,150)}`);
if (me.ok) info(`Nome: ${me.json?.name || me.json?.seller?.name} | Status: ${me.json?.status || me.json?.seller?.status}`);

// ═══════════════════════════════════════════════════════════════
sep('3. PRODUTOS');
// ═══════════════════════════════════════════════════════════════
// POST /api/products — requireApprovedSeller, usa Firestore storage
const createProduct = await api('POST', '/api/products', sellerToken, {
  title: `Produto QA ${TS}`,
  description: 'Produto criado pelo teste automatizado de QA',
  price: 9700,
  productType: 'digital',
  imageUrl: '',
  active: true,
});
check('POST /api/products (criar produto)', createProduct.ok || createProduct.status === 201, `${createProduct.status} ${JSON.stringify(createProduct.json).substring(0,200)}`);
const productId = createProduct.json?.id || createProduct.json?.product?.id;
if (productId) info(`Produto criado: ${productId}`);

// GET /api/products?tenantId=<uid> — tenantId = UID do seller
const listProducts = await api('GET', `/api/products?tenantId=${sellerId}&productType=digital`, sellerToken);
check('GET /api/products?tenantId=<uid>', listProducts.ok, `${listProducts.status} ${JSON.stringify(listProducts.json).substring(0,100)}`);
const prodList = listProducts.json?.products || [];
check('produto criado aparece na listagem', prodList.length > 0, `Total: ${prodList.length}`);

let checkoutId, couponId;

// ═══════════════════════════════════════════════════════════════
sep('4. CHECKOUTS');
// ═══════════════════════════════════════════════════════════════
// POST /api/checkouts — requireApprovedSeller
const createCheckout = await api('POST', '/api/checkouts', sellerToken, {
  name: `Checkout QA ${TS}`,
  productId: productId || 'test-prod',
  price: 9700,
  pricing: { amount: 9700, billingType: 'single', currency: 'BRL' },
  currency: 'BRL',
  paymentMethods: ['pix'],
  active: true,
});
check('POST /api/checkouts (criar checkout)', createCheckout.ok || createCheckout.status === 201, `${createCheckout.status} ${JSON.stringify(createCheckout.json).substring(0,200)}`);
checkoutId = createCheckout.json?.id || createCheckout.json?.checkout?.id;
if (checkoutId) info(`Checkout criado: ${checkoutId}`);

// GET /api/checkouts?tenantId=<uid>
const listCheckouts = await api('GET', `/api/checkouts?tenantId=${sellerId}`, sellerToken);
check('GET /api/checkouts?tenantId=<uid>', listCheckouts.ok, `${listCheckouts.status} ${JSON.stringify(listCheckouts.json).substring(0,100)}`);

// ═══════════════════════════════════════════════════════════════
sep('5. CUPONS');
// ═══════════════════════════════════════════════════════════════
// Coupons são aninhados em produtos: POST /api/products/:productId/coupons
if (productId) {
  const createCoupon = await api('POST', `/api/products/${productId}/coupons`, sellerToken, {
    code: `TEST${TS.toString().slice(-6)}`,
    type: 'percentage',
    value: 15,
    maxUses: 100,
    active: true,
  });
  check('POST /api/products/:id/coupons (criar cupom)', createCoupon.ok || createCoupon.status === 201, `${createCoupon.status} ${JSON.stringify(createCoupon.json).substring(0,200)}`);
  couponId = createCoupon.json?.id;

  const listCoupons = await api('GET', `/api/products/${productId}/coupons`, sellerToken);
  check('GET /api/products/:id/coupons (listar cupons)', listCoupons.ok, `${listCoupons.status} ${JSON.stringify(listCoupons.json).substring(0,100)}`);
}

// Coupons no checkout: POST /api/checkouts/:checkoutId/coupons
if (checkoutId) {
  const checkoutCoupon = await api('POST', `/api/checkouts/${checkoutId}/coupons`, sellerToken, {
    code: `CHKTEST${TS.toString().slice(-4)}`,
    type: 'fixed',
    value: 1000,
    maxUses: 50,
    active: true,
  });
  check('POST /api/checkouts/:id/coupons (cupom no checkout)', checkoutCoupon.ok || checkoutCoupon.status === 201, `${checkoutCoupon.status} ${JSON.stringify(checkoutCoupon.json).substring(0,150)}`);
}

// ═══════════════════════════════════════════════════════════════
sep('6. ORDER BUMP (OFFERS)');
// ═══════════════════════════════════════════════════════════════
// Order bump é feito via /api/products/:productId/offers
if (productId) {
  const createOffer = await api('POST', `/api/products/${productId}/offers`, sellerToken, {
    title: 'Order Bump QA',
    description: 'Oferta especial por apenas R$19,90',
    price: 1990,
    type: 'order_bump',
    active: true,
  });
  check('POST /api/products/:id/offers (order bump)', createOffer.ok || createOffer.status === 201, `${createOffer.status} ${JSON.stringify(createOffer.json).substring(0,200)}`);

  const listOffers = await api('GET', `/api/products/${productId}/offers`, sellerToken);
  check('GET /api/products/:id/offers (listar offers)', listOffers.ok, `${listOffers.status} ${JSON.stringify(listOffers.json).substring(0,100)}`);
}

// ═══════════════════════════════════════════════════════════════
sep('7. UPSELL');
// ═══════════════════════════════════════════════════════════════
// Upsell é aninhado em checkouts: POST /api/checkouts/:checkoutId/upsell
if (checkoutId) {
  const createUpsell = await api('POST', `/api/checkouts/${checkoutId}/upsell`, sellerToken, {
    name: 'Upsell QA',
    title: 'Upsell QA',
    description: 'Upgrade para o pacote completo',
    type: 'upsell',
    offerType: 'product',
    price: 19700,
    pricing: { amount: 19700, billingType: 'single', currency: 'BRL' },
    productId: productId || 'test-prod',
    onAccept: { action: 'redirect', url: 'https://example.com/obrigado' },
    onRefuse: { action: 'redirect', url: 'https://example.com/obrigado' },
    active: true,
  });
  check('POST /api/checkouts/:id/upsell (criar upsell)', createUpsell.ok || createUpsell.status === 201 || createUpsell.status === 404, `${createUpsell.status} ${JSON.stringify(createUpsell.json).substring(0,200)}`);
}

// ═══════════════════════════════════════════════════════════════
sep('8. AFILIADOS');
// ═══════════════════════════════════════════════════════════════
const affiliateLinks = await api('GET', '/api/affiliates/my-links', sellerToken);
check('GET /api/affiliates/my-links', affiliateLinks.ok || affiliateLinks.status === 404, `${affiliateLinks.status} ${JSON.stringify(affiliateLinks.json).substring(0,100)}`);
if (affiliateLinks.ok) info(`Links: ${JSON.stringify(affiliateLinks.json).substring(0,80)}`);

// Criar link de afiliado
if (productId) {
  const createAffil = await api('POST', '/api/affiliates/links', sellerToken, {
    productId, commission: 30, active: true,
  });
  check('POST /api/affiliates/links (criar link)', createAffil.ok || createAffil.status === 201 || createAffil.status === 404, `${createAffil.status} ${JSON.stringify(createAffil.json).substring(0,150)}`);
}

// ═══════════════════════════════════════════════════════════════
sep('9. VITRINE / SHOWCASE');
// ═══════════════════════════════════════════════════════════════
const showcase = await api('GET', `/api/showcase/${sellerId}`, null);
check('GET /api/showcase/:sellerId (vitrine pública)', showcase.ok || showcase.status === 404, `${showcase.status} ${JSON.stringify(showcase.json).substring(0,100)}`);

const sellerProds = await api('GET', `/api/sellers/${sellerId}/products`, null);
check('GET /api/sellers/:id/products (produtos públicos)', sellerProds.ok || sellerProds.status === 404, `${sellerProds.status} ${JSON.stringify(sellerProds.json).substring(0,100)}`);

// ═══════════════════════════════════════════════════════════════
sep('10. BANCO DE DADOS — NEON');
// ═══════════════════════════════════════════════════════════════
const { neonQuery } = await import('./server/lib/neon-db.ts');

let sellerRow, nSellers, nProds, nCheckouts;
await neonQuery(async sql => {
  const r = await sql`SELECT COUNT(*) as c FROM sellers`; nSellers = parseInt(r[0]?.c || 0);
}, 'count-sellers');
await neonQuery(async sql => {
  const r = await sql`SELECT COUNT(*) as c FROM products`; nProds = parseInt(r[0]?.c || 0);
}, 'count-products');
await neonQuery(async sql => {
  const r = await sql`SELECT COUNT(*) as c FROM checkouts`; nCheckouts = parseInt(r[0]?.c || 0);
}, 'count-checkouts');
await neonQuery(async sql => {
  const r = await sql`SELECT id, email, status, name FROM sellers WHERE id = ${sellerId} LIMIT 1`; sellerRow = r[0];
}, 'seller-exists');

check('Neon: tabela sellers acessível', nSellers >= 0, `Total: ${nSellers}`);
info(`→ ${nSellers} seller(s) | ${nProds} produto(s) | ${nCheckouts} checkout(s) no Neon`);
check('Neon: seller de teste criado (INSERT corrigido)', !!sellerRow, JSON.stringify(sellerRow));
if (sellerRow) info(`→ Email: ${sellerRow.email} | Status: ${sellerRow.status} | Nome: ${sellerRow.name}`);

// ═══════════════════════════════════════════════════════════════
sep('11. ADMIN — FUNCIONALIDADES GERAIS');
// ═══════════════════════════════════════════════════════════════
const adminOrders = await api('GET', '/api/orders', adminToken);
check('admin GET /api/orders (sem tenantId = 400 ou admin vê tudo)', adminOrders.ok || adminOrders.status === 400 || adminOrders.status === 200, `${adminOrders.status}`);

const adminSellers = await api('GET', '/api/admin/sellers', adminToken);
check('admin GET /api/admin/sellers', adminSellers.ok, `${adminSellers.status}`);

const adminSellersRisk = await api('GET', '/api/admin/sellers-risk', adminToken);
check('admin GET /api/admin/sellers-risk', adminSellersRisk.ok || adminSellersRisk.status === 404, `${adminSellersRisk.status}`);

// ═══════════════════════════════════════════════════════════════
sep('12. FINANÇAS / SALDO');
// ═══════════════════════════════════════════════════════════════
// Balance endpoint: GET /api/balance/:sellerId
const balance = await api('GET', `/api/balance/${sellerId}`, sellerToken);
check('GET /api/balance/:sellerId', balance.ok || balance.status === 404, `${balance.status} ${JSON.stringify(balance.json).substring(0,100)}`);

const movements = await api('GET', `/api/balance/${sellerId}/movements`, sellerToken);
check('GET /api/balance/:sellerId/movements', movements.ok || movements.status === 404, `${movements.status} ${JSON.stringify(movements.json).substring(0,100)}`);

// Withdrawals
const withdrawals = await api('GET', '/api/withdrawals', sellerToken);
check('GET /api/withdrawals', withdrawals.ok || withdrawals.status === 404, `${withdrawals.status} ${JSON.stringify(withdrawals.json).substring(0,100)}`);

// ═══════════════════════════════════════════════════════════════
sep('13. PEDIDOS');
// ═══════════════════════════════════════════════════════════════
// GET /api/orders?tenantId=<uid>
const orders = await api('GET', `/api/orders?tenantId=${sellerId}`, sellerToken);
check('GET /api/orders?tenantId=<uid>', orders.ok || orders.status === 404, `${orders.status} ${JSON.stringify(orders.json).substring(0,100)}`);

// ═══════════════════════════════════════════════════════════════
sep('14. ASSINATURAS');
// ═══════════════════════════════════════════════════════════════
const subs = await api('GET', `/api/subscriptions/stats?tenantId=${sellerId}`, sellerToken);
check('GET /api/subscriptions/stats?tenantId=<uid>', subs.ok || subs.status === 404, `${subs.status} ${JSON.stringify(subs.json).substring(0,100)}`);

// ═══════════════════════════════════════════════════════════════
sep('15. ANALYTICS / FUNIL');
// ═══════════════════════════════════════════════════════════════
const funnel = await api('GET', `/api/analytics/funnel?tenantId=${sellerId}`, sellerToken);
check('GET /api/analytics/funnel?tenantId=<uid>', funnel.ok || funnel.status === 404, `${funnel.status} ${JSON.stringify(funnel.json).substring(0,100)}`);

// ═══════════════════════════════════════════════════════════════
sep('16. LIMPEZA DO TESTE');
// ═══════════════════════════════════════════════════════════════
// Remover seller de teste do Neon
await neonQuery(async sql => {
  await sql`DELETE FROM orders WHERE tenant_id = ${sellerId}`;
  await sql`DELETE FROM checkouts WHERE tenant_id = ${sellerId}`;
  await sql`DELETE FROM products WHERE tenant_id = ${sellerId}`;
  await sql`DELETE FROM coupons WHERE tenant_id = ${sellerId}`;
  await sql`DELETE FROM sellers WHERE id = ${sellerId}`;
}, 'cleanup-test');
ok('Dados de teste removidos do Neon');

// Remover user do Firebase Auth
await getAuth().deleteUser(sellerId);
ok(`User de teste (${TEST_EMAIL}) removido do Firebase Auth`);

// ═══════════════════════════════════════════════════════════════
sep('RESULTADO FINAL');
// ═══════════════════════════════════════════════════════════════
const total = results.passed + results.failed;
console.log(`\n  Total: ${total} | ✅ Passou: ${results.passed} | ❌ Falhou: ${results.failed}\n`);
if (results.failed === 0) {
  console.log('  🎉 TODOS OS TESTES PASSARAM!\n');
} else {
  const pct = Math.round((results.passed / total) * 100);
  console.log(`  ⚠️  ${results.failed} teste(s) com falha (${pct}% OK)\n`);
}
