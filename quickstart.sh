#!/bin/bash
APP_DIR="/var/www/volatuspay"
echo "⚡ VolatusPay QuickStart v5..."

# Node.js 20
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm install -g pnpm pm2 tsx 2>/dev/null || true

# Código
if [ -d "$APP_DIR/.git" ]; then
  cd $APP_DIR && git pull origin main
else
  git clone https://github.com/volatuspay/volatuspay.git $APP_DIR
fi
cd $APP_DIR

# .env — NÃO sobrescreve se já existir com conteúdo real
if [ ! -f .env ] || ! grep -q "NEON_DATABASE_URL\|SESSION_SECRET\|ENCRYPTION_MASTER_KEY" .env 2>/dev/null; then
  cat > .env << 'ENVEOF'
NODE_ENV=production
PORT=3000
APP_BASE_URL=https://volatuspay.com
EFI_PRODUCTION=true
SKIP_ENV_VALIDATION=true
# === PREENCHA ABAIXO (obrigatório para app funcionar): ===
# NEON_DATABASE_URL=postgresql://...
# SESSION_SECRET=sua-chave-aqui
# ENCRYPTION_MASTER_KEY=sua-chave-aqui
# EFI_CLIENT_ID=seu-client-id
# EFI_CLIENT_SECRET=seu-client-secret
# EFI_PAYCODE=seu-paycode
# EFI_PIX_KEY_PLATFORM=sua-chave-pix
# FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
ENVEOF
  echo "⚠️  .env criado com template — adicione seus secrets depois!"
fi

# Dependências
pnpm install 2>/dev/null || npm install

# Nginx
apt-get install -y nginx 2>/dev/null || true
cat > /etc/nginx/sites-available/volatuspay << 'NGINXEOF'
server {
    listen 80;
    server_name volatuspay.com www.volatuspay.com app.volatuspay.com _;
    client_max_body_size 50M;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
NGINXEOF
ln -sf /etc/nginx/sites-available/volatuspay /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# DIAGNÓSTICO: Rodar tsx direto por 8s para ver o erro real
echo ""
echo "=== DIAGNÓSTICO: Testando startup do app (8s) ==="
TSX_BIN=$(which tsx 2>/dev/null || echo "tsx")
cd $APP_DIR
timeout 8 $TSX_BIN server/index.ts > /tmp/vp-startup.log 2>&1 || true
echo "--- Saída do startup ---"
cat /tmp/vp-startup.log
echo "--- Fim ---"

# Checar se porta 3000 respondeu durante o teste
if grep -q "listening\|started\|Server\|port 3000\|:3000" /tmp/vp-startup.log 2>/dev/null; then
  echo "✅ App iniciou! Configurando PM2..."
else
  echo "⚠️  App não iniciou nos 8s. Verificar logs acima."
fi

# Criar ecosystem.config.cjs
cat > $APP_DIR/ecosystem.config.cjs << ECOEOF
module.exports = {
  apps: [{
    name: 'volatuspay',
    script: '$TSX_BIN',
    args: 'server/index.ts',
    cwd: '$APP_DIR',
    interpreter: 'none',
    env_file: '$APP_DIR/.env'
  }]
}
ECOEOF

# PM2
pm2 delete volatuspay 2>/dev/null || true
pm2 start $APP_DIR/ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null | grep "^sudo\|^env" | head -1 | bash || true

# SSL
apt-get install -y certbot python3-certbot-nginx 2>/dev/null || true
certbot --nginx -d volatuspay.com -d www.volatuspay.com \
  --non-interactive --agree-tos -m admin@volatuspay.com --redirect 2>/dev/null || true

echo ""
echo "=== STATUS FINAL ==="
pm2 status
sleep 5
echo "=== PM2 LOGS (ultimas 30 linhas) ==="
pm2 logs volatuspay --lines 30 --nostream 2>/dev/null || true
