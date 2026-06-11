/**
 * DEPLOY FIRESTORE SECURITY RULES via Firebase Management API
 * 
 * Usa as credenciais do Service Account para:
 * 1. Gerar JWT de autenticação
 * 2. Criar novo ruleset no Firebase Security Rules API
 * 3. Publicar o release cloud.firestore
 * 
 * Uso: node apply-firestore-rules.mjs
 */

import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const PROJECT_ID = process.env.FIREBASE_ADMIN_PROJECT_ID || 'suaempresa-aqui';
const CLIENT_EMAIL = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!CLIENT_EMAIL || !PRIVATE_KEY) {
  console.error('✘ FIREBASE_ADMIN_CLIENT_EMAIL ou FIREBASE_ADMIN_PRIVATE_KEY não encontrados no .env');
  process.exit(1);
}

console.log('══════════════════════════════════════════════════════');
console.log('  DEPLOY FIRESTORE SECURITY RULES');
console.log(`  Projeto: ${PROJECT_ID}`);
console.log(`  Service Account: ${CLIENT_EMAIL}`);
console.log('══════════════════════════════════════════════════════\n');

// Ler as regras
const rulesPath = join(__dirname, 'firestore.rules');
const rulesContent = readFileSync(rulesPath, 'utf-8');
console.log(`✔ firestore.rules lido (${rulesContent.length} chars)\n`);

// ── JWT / Access Token ─────────────────────────────────────

function base64url(data) {
  return Buffer.from(data).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function createJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: CLIENT_EMAIL,
    sub: CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  }));
  const data = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(data);
  const sig = base64url(sign.sign(PRIVATE_KEY));
  return `${data}.${sig}`;
}

async function getAccessToken() {
  const jwt = createJWT();
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Erro ao obter access token: ${err}`);
  }
  const { access_token } = await resp.json();
  return access_token;
}

// ── Firebase Security Rules API ────────────────────────────

async function createRuleset(token) {
  const url = `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets`;
  const body = {
    source: {
      files: [{ name: 'firestore.rules', content: rulesContent }],
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Erro ao criar ruleset: ${err}`);
  }
  const data = await resp.json();
  console.log(`✔ Ruleset criado: ${data.name}`);
  return data.name; // ex: projects/suaempresa-aqui/rulesets/abc123
}

async function publishRelease(token, rulesetName) {
  const releaseName = `projects/${PROJECT_ID}/releases/cloud.firestore`;
  const url = `https://firebaserules.googleapis.com/v1/${releaseName}`;

  // Tentar PATCH (update) primeiro
  let resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      release: {
        name: releaseName,
        rulesetName,
      },
    }),
  });

  // Se não existir (404), criar com PUT
  if (resp.status === 404) {
    const createUrl = `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`;
    resp = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: releaseName,
        rulesetName,
      }),
    });
  }

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Erro ao publicar release: ${err}`);
  }
  const data = await resp.json();
  console.log(`✔ Release publicado: ${data.name}`);
}

// ── Main ───────────────────────────────────────────────────

try {
  console.log('1/3 Obtendo access token do Google OAuth...');
  const token = await getAccessToken();
  console.log('✔ Access token obtido\n');

  console.log('2/3 Criando novo ruleset...');
  const rulesetName = await createRuleset(token);
  console.log();

  console.log('3/3 Publicando release cloud.firestore...');
  await publishRelease(token, rulesetName);
  console.log();

  console.log('══════════════════════════════════════════════════════');
  console.log('  ✔ REGRAS DO FIRESTORE APLICADAS COM SUCESSO!');
  console.log(`  Verifique em:`);
  console.log(`  https://console.firebase.google.com/project/${PROJECT_ID}/firestore/rules`);
  console.log('══════════════════════════════════════════════════════');

} catch (err) {
  console.error('\n✘ Falha no deploy automático:', err.message);
  console.error('\n━━━ ALTERNATIVA MANUAL ━━━\n');
  console.log(`Acesse: https://console.firebase.google.com/project/${PROJECT_ID}/firestore/rules`);
  console.log('\nCole o conteúdo de firestore.rules e clique em Publicar.\n');
  console.log('━'.repeat(60));
  console.log(rulesContent);
  console.log('━'.repeat(60));
  process.exit(1);
}
