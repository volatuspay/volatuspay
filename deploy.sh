#!/bin/bash
set -e
DOMAIN="volatuspay.com"
GITHUB_REPO="https://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@github.com/volatuspay/volatuspay.git"
APP_DIR="/var/www/volatuspay"
NODE_VERSION="20"

echo "=========================================="
echo "  VolatusPay — Deploy de Produção"
echo "=========================================="

# 1. Atualizar sistema
apt-get update -q && apt-get upgrade -y -q

# 2. Instalar dependências do sistema
apt-get install -y -q curl git nginx certbot python3-certbot-nginx ufw build-essential

# 3. Instalar Node.js 20 LTS
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
echo "✅ Node.js $(node -v)"

# 4. Instalar pnpm
if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm@latest
fi
echo "✅ pnpm $(pnpm -v)"

# 5. Instalar PM2
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
fi
echo "✅ PM2 instalado"

# 6. Clonar/atualizar código do GitHub
if [ -d "$APP_DIR/.git" ]; then
  echo "📥 Atualizando código..."
  cd $APP_DIR && git pull origin main
else
  echo "📥 Clonando repositório..."
  git clone $GITHUB_REPO $APP_DIR
fi
cd $APP_DIR

# 7. Instalar dependências
echo "📦 Instalando dependências..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# 8. Criar diretórios necessários
mkdir -p server/certs uploads public/downloads

# 9. Gerar arquivo .env de produção
cat > .env << 'ENVEOF'
NODE_ENV=production
PORT=3000
EFI_PRODUCTION=true
ENVEOF

echo ""
echo "⚠️  ATENÇÃO: Edite o arquivo .env com suas variáveis reais:"
echo "    nano $APP_DIR/.env"
echo ""
echo "  Adicione estas variáveis:"
echo "    EFI_CLIENT_ID=..."
echo "    EFI_CLIENT_SECRET=..."
echo "    EFI_PAYCODE=..."
echo "    EFI_PIX_KEY_PLATFORM=..."
echo "    NEON_DATABASE_URL=..."
echo "    SESSION_SECRET=..."
echo "    ENCRYPTION_MASTER_KEY=..."
echo ""
read -p "Pressione ENTER depois de configurar o .env..."

# 10. Build (se tiver script de build)
if grep -q '"build"' package.json 2>/dev/null; then
  echo "🔨 Fazendo build..."
  NODE_ENV=production pnpm run build 2>/dev/null || echo "Build ignorado (tsx direto)"
fi

# 11. Configurar nginx
cat > /etc/nginx/sites-available/volatuspay << NGINXEOF
server {
    listen 80;
    server_name volatuspay.com www.volatuspay.com app.volatuspay.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/volatuspay /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "✅ Nginx configurado"

# 12. Firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "✅ Firewall configurado"

# 13. SSL com Certbot
echo "🔒 Instalando SSL..."
certbot --nginx -d volatuspay.com -d www.volatuspay.com -d app.volatuspay.com \
  --non-interactive --agree-tos -m admin@volatuspay.com \
  --redirect || echo "⚠️  SSL falhou — configure manualmente depois"

# 14. Iniciar app com PM2
pm2 delete volatuspay 2>/dev/null || true
pm2 start node_modules/.bin/tsx --name volatuspay \
  --env production \
  -- server/index.ts

pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

echo ""
echo "=========================================="
echo "  🎉 Deploy concluído!"
echo "  🌐 https://volatuspay.com"
echo "=========================================="
pm2 status
