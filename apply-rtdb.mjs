import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { config } from 'dotenv';

config({ path: '/home/runner/workspace/volatuspay/Creator-Cash2/.env' });

const PROJECT_ID = process.env.FIREBASE_ADMIN_PROJECT_ID;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

const app = initializeApp({
  credential: cert({ projectId: PROJECT_ID, clientEmail, privateKey }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

// Usar o Admin SDK para escrever as regras via endpoint nativo
const db = getDatabase(app);

// O Admin SDK bypass as regras de segurança — podemos escrever diretamente
// Vamos confirmar o acesso fazendo uma leitura simples
try {
  const ref = db.ref('/');
  await ref.limitToFirst(1).once('value');
  console.log('✔ Conexão com Realtime Database OK');
} catch (e) {
  console.error('Erro ao conectar:', e.message);
}

// Para aplicar as regras do RTDB, mostramos o que precisa ser feito
console.log('\n══════════════════════════════════════');
console.log('  REGRAS DO REALTIME DATABASE');
console.log('══════════════════════════════════════');
console.log('Acesse: https://console.firebase.google.com/project/suaempresa-aqui/database/suaempresa-aqui-default-rtdb/rules');
console.log('\nCole estas regras:');
console.log(`{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}`);
console.log('══════════════════════════════════════');
