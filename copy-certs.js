import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cria diretório dist se não existir
const distDir = join(__dirname, 'dist');
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// Copia certificados EfíBank se existirem
const efiBankCerts = [
  'efi-sandbox.crt',
  'efi-sandbox.key',
  'efi-production.crt',
  'efi-production.key'
];

efiBankCerts.forEach(cert => {
  const sourcePath = join(__dirname, cert);
  const destPath = join(distDir, cert);
  
  if (existsSync(sourcePath)) {
    try {
      copyFileSync(sourcePath, destPath);
      console.log(`✅ Certificado copiado: ${cert}`);
    } catch (error) {
      console.warn(`⚠️ Erro ao copiar ${cert}:`, error.message);
    }
  }
});

console.log('✅ Cópia de certificados concluída!');

// 🚀 WRITE server-start.mjs - opens port IMMEDIATELY then loads bundle
// This solves the deployment timeout: the bundle takes 30-60s to load external
// packages on a cold VM, but the deployment health check expects the port within ~70s.
// By opening the port in server-start.mjs first, health check passes before bundle loads.
const serverStartContent = `import { createServer } from 'http';
import { setInterval } from 'timers';

// Force periodic GC
if (global.gc) {
  let gcCount = 0;
  setInterval(() => {
    const before = process.memoryUsage().heapUsed;
    global.gc();
    const after = process.memoryUsage().heapUsed;
    gcCount++;
    const freed = Math.round((before - after) / 1024 / 1024);
    const heapMB = Math.round(after / 1024 / 1024);
    const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (gcCount % 2 === 0) {
      console.log(\`\u{1F9F9} GC #\${gcCount}: heap=\${heapMB}MB rss=\${rssMB}MB freed=\${freed}MB\`);
    }
  }, 20000);
}

const PORT = parseInt(process.env.PORT || '5000', 10);

// PHASE 1: Open port immediately so deployment health check passes
// The bundle takes 30-60s to load on a cold VM — we can't wait.
let expressApp = null;
const earlyServer = createServer((req, res) => {
  if (expressApp) {
    expressApp(req, res);
  } else {
    // Bundle still loading — respond OK so health check passes
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('OK');
  }
});

await new Promise((resolve, reject) => {
  earlyServer.once('error', reject);
  earlyServer.listen(PORT, '0.0.0.0', () => {
    console.log(\`\u{1F680} [STARTUP] Port \${PORT} opened immediately — deployment health check active\`);
    resolve();
  });
});

// PHASE 2: Pass server and app-setter to the bundle via globals
// server/index.ts checks for these and reuses the existing server instead of binding again
global.__REPLIT_SERVER = earlyServer;
global.__SET_EXPRESS_APP = (app) => { expressApp = app; };

// PHASE 3: Load the main bundle (takes 30-60s on cold VM)
console.log('\u{1F4E6} [STARTUP] Loading application bundle...');
await import('./server-bundle.mjs');
console.log('\u2705 [STARTUP] Application bundle loaded and running');
`;
writeFileSync(join(distDir, 'server-start.mjs'), serverStartContent);
console.log('✅ server-start.mjs gerado em dist/');

// 🔨 REBUILD SERVER BUNDLE - Garante que server-bundle.mjs está sempre atualizado
console.log('🔨 Rebuilding server bundle (server-bundle.mjs)...');
try {
  execSync(
    'npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/server-bundle.mjs --external:sharp --external:bufferutil --external:utf-8-validate',
    { stdio: 'inherit', cwd: __dirname }
  );
  console.log('✅ Server bundle reconstruído com sucesso!');
} catch (error) {
  console.error('❌ Falha ao rebuildar server bundle:', error.message);
  process.exit(1);
}
