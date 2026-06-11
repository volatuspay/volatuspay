/**
 * Script para salvar certs ONZ Finance no Firebase RTDB
 * Executar no VPS: node save-onz-certs-node.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Carregar .env manualmente
const envPath = path.join('/var/www/zenpagamentos', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let value = trimmed.substring(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
  console.log('[.env] Carregado de', envPath);
}

// Importar firebase-admin
const admin = require('/var/www/zenpagamentos/node_modules/firebase-admin');

const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!privateKey || !process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_ADMIN_CLIENT_EMAIL) {
  console.error('❌ Variáveis Firebase não configuradas no .env');
  console.error('Precisa: FIREBASE_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY, FIREBASE_DATABASE_URL');
  process.exit(1);
}

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

const certsBase = '/var/www/zenpagamentos/certs/onz';

const qrcodesCert  = fs.readFileSync(path.join(certsBase, 'qrcodes/BASSPAGO_77.crt'));
const qrcodesKey   = fs.readFileSync(path.join(certsBase, 'qrcodes/BASSPAGO_77.key'));
const accountsCert = fs.readFileSync(path.join(certsBase, 'accounts/BASSPAGO_77.crt'));
const accountsKey  = fs.readFileSync(path.join(certsBase, 'accounts/BASSPAGO_77.key'));

console.log(`✅ QRCodes cert:  ${qrcodesCert.length} bytes`);
console.log(`✅ QRCodes key:   ${qrcodesKey.length} bytes`);
console.log(`✅ Accounts cert: ${accountsCert.length} bytes`);
console.log(`✅ Accounts key:  ${accountsKey.length} bytes`);

const cashInSecret  = 'KA3WJttE9phd3ULpfa8bmv8xgfNqoGz7_24tapjgFQuVzN-BAPzEQ--s2i';
const cashOutSecret = 'fL_JsMDzy7eMYojt9xqstVb7ra*iqW.xfrocqGM2L_xnzFNN4NjZ@AYzUtRM';
const pixKey        = process.env.ONZ_PIX_KEY || '';

console.log('\n📤 Salvando no Firebase RTDB...');

await rtdb.ref('tetri-system/onz-finance').set({
  certs: {
    qrcodes: {
      cert: qrcodesCert.toString('base64'),
      key:  qrcodesKey.toString('base64'),
      savedAt: new Date().toISOString(),
    },
    accounts: {
      cert: accountsCert.toString('base64'),
      key:  accountsKey.toString('base64'),
      savedAt: new Date().toISOString(),
    },
    eternal: true,
    version: 'PROD',
    partner: 'BASSPAGO_77',
    savedAt: new Date().toISOString(),
  },
  credentials: {
    cashInClientId:      'BASSPAGO_77',
    cashInClientSecret:  cashInSecret,
    cashOutClientId:     'BASSPAGO_77',
    cashOutClientSecret: cashOutSecret,
    pixKey:              pixKey,
    environment:         'production',
    enabled:             true,
    savedAt:             new Date().toISOString(),
    eternal:             true,
  },
});

console.log('\n🎉 Certificados ONZ Finance PROD salvos ETERNAMENTE no Firebase RTDB!');
console.log('Path: tetri-system/onz-finance');
process.exit(0);
