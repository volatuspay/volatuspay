/**
 * 🧪 TESTE ONZ Finance — gera um PIX de R$1,00 de teste
 * Uso: node test-onz-pix.mjs [pixKey]
 * Se pixKey for passado, atualiza no RTDB e usa para o teste
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ─── Carregar .env ────────────────────────────────────────────────────────────
const envPath = '/var/www/zenpagamentos/.env';
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const ei = t.indexOf('=');
    if (ei < 1) continue;
    const k = t.slice(0, ei).trim();
    let v = t.slice(ei + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

// ─── Firebase Admin ───────────────────────────────────────────────────────────
const admin = require('/var/www/zenpagamentos/node_modules/firebase-admin');
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const rtdb = admin.database();

// ─── Ler credenciais do RTDB ──────────────────────────────────────────────────
const rtdbSnap = await rtdb.ref('tetri-system/onz-finance').once('value');
const rtdbData = rtdbSnap.val();

if (!rtdbData?.credentials || !rtdbData?.certs) {
  console.error('❌ Dados ONZ não encontrados no RTDB. Execute save-onz-certs.mjs primeiro.');
  process.exit(1);
}

const creds = rtdbData.credentials;
const certsData = rtdbData.certs;

// Chave PIX: pode vir do argumento ou do RTDB
const pixKeyArg = process.argv[2];
const pixKey = pixKeyArg || creds.pixKey || '';

if (!pixKey) {
  console.error('❌ Chave PIX não configurada!');
  console.error('   Passe como argumento: node test-onz-pix.mjs <sua_chave_pix>');
  console.error('   Exemplos: node test-onz-pix.mjs 11999887766');
  console.error('             node test-onz-pix.mjs 00000000000 (CPF)');
  console.error('             node test-onz-pix.mjs email@dominio.com');
  process.exit(1);
}

// Se vier do argumento, salvar no RTDB
if (pixKeyArg && pixKeyArg !== creds.pixKey) {
  await rtdb.ref('tetri-system/onz-finance/credentials/pixKey').set(pixKeyArg);
  console.log(`✅ Chave PIX salva no RTDB: ${pixKeyArg}`);
}

console.log(`\n📋 Configuração ONZ:`);
console.log(`   Client ID:   ${creds.cashInClientId}`);
console.log(`   PIX Key:     ${pixKey}`);
console.log(`   Ambiente:    ${creds.environment}`);
console.log(`   Habilitado:  ${creds.enabled}`);

// ─── Montar certs ─────────────────────────────────────────────────────────────
const qrcodesCert = Buffer.from(certsData.qrcodes.cert, 'base64');
const qrcodesKey  = Buffer.from(certsData.qrcodes.key,  'base64');

console.log(`\n🔐 Certificados mTLS:`);
console.log(`   QRCodes cert: ${qrcodesCert.length} bytes`);
console.log(`   QRCodes key:  ${qrcodesKey.length} bytes`);

// ─── Obter token OAuth2 ───────────────────────────────────────────────────────
const isProduction = creds.environment === 'production';
const tokenHost = isProduction ? 'api.qrcodes.sulcredi.coop.br' : 'api.qrcodes-h.sulcredi.coop.br';
const cobHost   = tokenHost;

console.log(`\n🔑 Obtendo token OAuth2 de: ${tokenHost}`);

function httpsPost(host, path, headers, body, agentOpts) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent(agentOpts);
    const opts = { hostname: host, port: 443, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, agent };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsRequest(host, path, method, headers, body, agentOpts) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent(agentOpts);
    const opts = { hostname: host, port: 443, path, method, headers: body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers, agent };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const agentOpts = { cert: qrcodesCert, key: qrcodesKey, rejectUnauthorized: true };

// 1. Obter token
const tokenBody = `grant_type=client_credentials&client_id=${encodeURIComponent(creds.cashInClientId)}&client_secret=${encodeURIComponent(creds.cashInClientSecret)}`;

const tokenResp = await httpsPost(tokenHost, '/oauth/token', {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept': 'application/json',
}, tokenBody, agentOpts);

if (!tokenResp.body?.access_token) {
  console.error('\n❌ Falha ao obter token OAuth2:');
  console.error('   Status:', tokenResp.status);
  console.error('   Body:', JSON.stringify(tokenResp.body, null, 2));
  process.exit(1);
}

const token = tokenResp.body.access_token;
console.log(`✅ Token obtido! (expira em ${tokenResp.body.expires_in}s)`);

// 2. Criar cobrança PIX de R$1,00
const testOrderId = `test${Date.now()}`;
const payload = {
  calendario: { expiracao: 3600 },
  valor: { original: '1.00' },
  chave: pixKey,
  solicitacaoPagador: `TESTE ONZ Finance - Zen Pagamentos`,
  infoAdicionais: [
    { nome: 'OrderId', valor: testOrderId },
    { nome: 'Teste', valor: 'Cobranca de verificacao' },
  ],
};

console.log(`\n💸 Criando cobrança PIX de R$1,00 (txid: ${testOrderId})...`);

const cobResp = await httpsRequest(cobHost, '/cob', 'POST', {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}, JSON.stringify(payload), agentOpts);

console.log(`\n📊 Resposta da API ONZ (HTTP ${cobResp.status}):`);
console.log(JSON.stringify(cobResp.body, null, 2));

if (cobResp.status >= 200 && cobResp.status < 300 && cobResp.body?.txid) {
  const txid  = cobResp.body.txid;
  const brCode = cobResp.body.pixCopiaECola || cobResp.body.brCode || '';
  const loc   = cobResp.body.location || cobResp.body.loc?.location || '';

  console.log('\n🎉 ================================');
  console.log('   PIX REAL GERADO COM SUCESSO!');
  console.log('================================');
  console.log(`   txid:     ${txid}`);
  console.log(`   brCode:   ${brCode ? brCode.substring(0, 60) + '...' : '(vazio)'}`);
  console.log(`   location: ${loc}`);
  console.log(`   status:   ${cobResp.body.status}`);
  console.log(`   valor:    R$ ${cobResp.body.valor?.original}`);
  console.log(`   expira:   ${cobResp.body.calendario?.expiracao}s`);

  // 3. Buscar cobrança para confirmar
  const getResp = await httpsRequest(cobHost, `/cob/${txid}`, 'GET', {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  }, null, agentOpts);

  console.log(`\n✅ Verificação da cobrança (GET /cob/${txid}):`);
  console.log(`   status: ${getResp.body?.status}`);
  console.log(`   valor:  R$ ${getResp.body?.valor?.original}`);
  console.log(`   chave:  ${getResp.body?.chave}`);

  // 4. Salvar txid no RTDB como comprovante do teste
  await rtdb.ref('tetri-system/onz-finance/last-test').set({
    txid, brCode, loc,
    status: cobResp.body.status,
    testedAt: new Date().toISOString(),
    amountBRL: '1.00',
    orderId: testOrderId,
  });
  console.log('\n✅ Resultado do teste salvo no RTDB (tetri-system/onz-finance/last-test)');

} else {
  console.error('\n❌ Falha ao criar cobrança PIX:');
  console.error('   Status:', cobResp.status);
}

process.exit(0);
