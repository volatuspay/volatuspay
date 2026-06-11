import { writeFileSync, readFileSync, existsSync } from 'fs';

// ── Lê o arquivo .env como fallback quando as vars não estão no process.env ──
function loadDotEnv(filePath = '.env') {
  const vars = {};
  if (!existsSync(filePath)) return vars;
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    vars[key] = val;
  }
  return vars;
}

const dotenv = loadDotEnv('.env');

function getVar(key) {
  return process.env[key] || dotenv[key] || '';
}

const apiKey            = getVar('VITE_FIREBASE_API_KEY');
const authDomain        = getVar('VITE_FIREBASE_AUTH_DOMAIN');
const databaseURL       = getVar('VITE_FIREBASE_DATABASE_URL');
const projectId         = getVar('VITE_FIREBASE_PROJECT_ID');
const storageBucket     = getVar('VITE_FIREBASE_STORAGE_BUCKET');
const messagingSenderId = getVar('VITE_FIREBASE_MESSAGING_SENDER_ID');
const appId             = getVar('VITE_FIREBASE_APP_ID');
const measurementId     = getVar('VITE_FIREBASE_MEASUREMENT_ID');
const platformDomain    = getVar('VITE_PLATFORM_DOMAIN');

// Validação: avisar se a chave principal estiver vazia
if (!apiKey) {
  console.error('❌ VITE_FIREBASE_API_KEY está vazia! Verifique o .env');
  process.exit(1);
}
console.log(`🔑 Firebase API Key: ${apiKey.slice(0, 12)}… (${projectId})`);

// ── 1. .env.production ─────────────────────────────────────────────────────
const envVars = `# White-Label Gateway — Auto-generated from Secrets
VITE_FIREBASE_API_KEY=${apiKey}
VITE_FIREBASE_AUTH_DOMAIN=${authDomain}
VITE_FIREBASE_DATABASE_URL=${databaseURL}
VITE_FIREBASE_PROJECT_ID=${projectId}
VITE_FIREBASE_STORAGE_BUCKET=${storageBucket}
VITE_FIREBASE_MESSAGING_SENDER_ID=${messagingSenderId}
VITE_FIREBASE_APP_ID=${appId}
VITE_FIREBASE_MEASUREMENT_ID=${measurementId}
`;

try {
  // Vite root is "client/" so it reads .env files from client/ directory
  writeFileSync('client/.env.production', envVars.trim());
  writeFileSync('.env.production', envVars.trim()); // keep root copy for reference
  console.log('✅ Variáveis VITE_* injetadas em client/.env.production');
} catch (error) {
  console.error('❌ Erro ao criar .env.production:', error.message);
  process.exit(1);
}

// ── 2. Service Workers — Firebase config ───────────────────────────────────
const firebaseConfigBlock = `firebase.initializeApp({
  apiKey: '${apiKey}',
  authDomain: '${authDomain}',
  databaseURL: '${databaseURL}',
  projectId: '${projectId}',
  storageBucket: '${storageBucket}',
  messagingSenderId: '${messagingSenderId}',
  appId: '${appId}',
  measurementId: '${measurementId}'
});`;

const baseUrl = platformDomain ? `https://${platformDomain}` : '';

const SWS = [
  'client/public/sw.js',
  'client/public/firebase-messaging-sw.js',
];

for (const swPath of SWS) {
  try {
    let content = readFileSync(swPath, 'utf-8');

    content = content.replace(
      /firebase\.initializeApp\(\{[\s\S]*?\}\);/,
      firebaseConfigBlock
    );

    content = content.replace(
      /(?:var\s+)?(?:const\s+)?BASE_URL\s*=\s*['"]https?:\/\/[^'"]+['"]/g,
      `const BASE_URL = '${baseUrl}'`
    );
    content = content.replace(
      /['"]https:\/\/zenpagamentos\.com\.br['"]/g,
      `'${baseUrl}'`
    );

    writeFileSync(swPath, content, 'utf-8');
    console.log(`✅ ${swPath} atualizado com config do Firebase`);
  } catch (err) {
    console.error(`❌ Erro ao atualizar ${swPath}:`, err.message);
  }
}
