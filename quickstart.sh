#!/bin/bash
set -e
APP_DIR="/var/www/volatuspay"
echo "⚡ VolatusPay QuickStart v2..."

# Node.js 20
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# pnpm + pm2
npm install -g pnpm pm2 2>/dev/null || true

# Código
if [ -d "$APP_DIR/.git" ]; then
  cd $APP_DIR && git pull origin main
else
  git clone https://github.com/volatuspay/volatuspay.git $APP_DIR
fi
cd $APP_DIR

# .env
[ -f .env ] || cat > .env << 'ENVEOF'
NODE_ENV=production
PORT=3000
APP_BASE_URL=https://volatuspay.com
EFI_PRODUCTION=true
SKIP_ENV_VALIDATION=true
ENVEOF

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

# Encontrar tsx
TSX=$(find $APP_DIR/node_modules -name "tsx" -type f -path "*/bin/*" 2>/dev/null | head -1)
[ -z "$TSX" ] && TSX=$(which tsx 2>/dev/null || npm install -g tsx && which tsx)
[ -z "$TSX" ] && TSX="$APP_DIR/node_modules/.bin/tsx"
echo "Usando tsx: $TSX"

# PM2
pm2 delete volatuspay 2>/dev/null || true
cd $APP_DIR && pm2 start "$TSX" --name volatuspay -- server/index.ts
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null | grep "^sudo" | bash || true

# SSL
apt-get install -y certbot python3-certbot-nginx 2>/dev/null || true
certbot --nginx -d volatuspay.com -d www.volatuspay.com \
  --non-interactive --agree-tos -m admin@volatuspay.com --redirect 2>/dev/null || true

echo ""
echo "=== STATUS ==="
pm2 status
sleep 3
curl -s http://localhost:3000/_health && echo "✅ App OK!" || echo "❌ App não respondeu ainda — veja: pm2 logs volatuspay"
