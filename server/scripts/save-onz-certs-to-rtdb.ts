/**
 * 🏦 SCRIPT: Salvar certificados ONZ Finance no Firebase RTDB (eterno)
 * 
 * Uso: npx ts-node save-onz-certs-to-rtdb.ts [caminho-certs]
 * 
 * Onde os certs ficam no VPS:
 *   /var/www/zenpagamentos/certs/onz/qrcodes/BASSPAGO_77.crt
 *   /var/www/zenpagamentos/certs/onz/qrcodes/BASSPAGO_77.key
 *   /var/www/zenpagamentos/certs/onz/accounts/BASSPAGO_77.crt
 *   /var/www/zenpagamentos/certs/onz/accounts/BASSPAGO_77.key
 */

import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  // Init Firebase Admin
  if (!admin.apps.length) {
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
        privateKey,
      } as any),
      databaseURL: process.env.FIREBASE_DATABASE_URL!,
    });
  }

  const rtdb = admin.database();

  // Caminho base dos certs (pode ser passado como argumento)
  const certsBase = process.argv[2] || path.join(process.cwd(), 'certs/onz');

  const paths = {
    qrcodesCert:  path.join(certsBase, 'qrcodes/BASSPAGO_77.crt'),
    qrcodesKey:   path.join(certsBase, 'qrcodes/BASSPAGO_77.key'),
    accountsCert: path.join(certsBase, 'accounts/BASSPAGO_77.crt'),
    accountsKey:  path.join(certsBase, 'accounts/BASSPAGO_77.key'),
  };

  // Verificar que todos os arquivos existem
  for (const [name, p] of Object.entries(paths)) {
    if (!fs.existsSync(p)) {
      console.error(`❌ Arquivo não encontrado: ${name} -> ${p}`);
      process.exit(1);
    }
    console.log(`✅ ${name}: ${p} (${fs.statSync(p).size} bytes)`);
  }

  // Ler os arquivos
  const qrcodesCert  = fs.readFileSync(paths.qrcodesCert);
  const qrcodesKey   = fs.readFileSync(paths.qrcodesKey);
  const accountsCert = fs.readFileSync(paths.accountsCert);
  const accountsKey  = fs.readFileSync(paths.accountsKey);

  // Salvar no RTDB
  await rtdb.ref('tetri-system/onz-finance/certs').set({
    qrcodes: {
      cert:    qrcodesCert.toString('base64'),
      key:     qrcodesKey.toString('base64'),
      savedAt: new Date().toISOString(),
      sizeBytes: { cert: qrcodesCert.length, key: qrcodesKey.length },
    },
    accounts: {
      cert:    accountsCert.toString('base64'),
      key:     accountsKey.toString('base64'),
      savedAt: new Date().toISOString(),
      sizeBytes: { cert: accountsCert.length, key: accountsKey.length },
    },
    eternal: true,
    version: 'PROD',
    partner: 'BASSPAGO_77',
    savedAt: new Date().toISOString(),
  });

  console.log('\n🎉 Certificados ONZ Finance PROD salvos ETERNAMENTE no Firebase RTDB!');
  console.log('Path: tetri-system/onz-finance/certs');
  console.log('\nCertificados salvos:');
  console.log(`  QRCodes cert: ${qrcodesCert.length} bytes → base64: ${qrcodesCert.toString('base64').length} chars`);
  console.log(`  QRCodes key:  ${qrcodesKey.length} bytes → base64: ${qrcodesKey.toString('base64').length} chars`);
  console.log(`  Accounts cert: ${accountsCert.length} bytes → base64: ${accountsCert.toString('base64').length} chars`);
  console.log(`  Accounts key:  ${accountsKey.length} bytes → base64: ${accountsKey.toString('base64').length} chars`);

  // Salvar credenciais também
  const cashInClientId = process.env.ONZ_CASH_IN_CLIENT_ID || 'BASSPAGO_77';
  const cashInClientSecret = process.env.ONZ_CASH_IN_SECRET || '';
  const cashOutClientId = process.env.ONZ_CASH_OUT_CLIENT_ID || 'BASSPAGO_77';
  const cashOutClientSecret = process.env.ONZ_CASH_OUT_SECRET || '';
  const pixKey = process.env.ONZ_PIX_KEY || '';

  if (cashInClientSecret && cashOutClientSecret) {
    await rtdb.ref('tetri-system/onz-finance/credentials').set({
      cashInClientId,
      cashInClientSecret,
      cashOutClientId,
      cashOutClientSecret,
      pixKey,
      environment:  'production',
      enabled:      true,
      savedAt:      new Date().toISOString(),
      eternal:      true,
    });
    console.log('\n✅ Credenciais ONZ Finance salvas no RTDB!');
  } else {
    console.log('\n⚠️ Credenciais não salvas (ONZ_CASH_IN_SECRET ou ONZ_CASH_OUT_SECRET não configurados no .env)');
    console.log('Configure via Admin > Pagamentos > Chaves > ONZ Finance');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
