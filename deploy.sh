#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  TakePay — Deploy Script
#  Uso: bash deploy.sh [all|vps|setup]
#   all   → deploy completo na VPS (padrão)
#   vps   → alias para all
#   setup → configurar VPS pela primeira vez
#
#  Autenticação: chave SSH em ~/.ssh/id_ed25519
#  (sem senha — chave pública precisa estar na VPS)
# ═══════════════════════════════════════════════════════════
set -e

# ─── CONFIG ───────────────────────────────────────────────
VPS_IP="${VPS_IP:-167.86.106.230}"
SSH_ACCT="root"
APP_DIR="/var/www/takepay"
DOMAIN="takepay.com.br"
SCRIPT_ROOT="$(cd "$(dirname "$0")" && pwd)"

SSH_KEY="$HOME/.ssh/id_ed25519"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=30"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=30"
# ─────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()     { echo -e "${BLUE}[DEPLOY]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

[ ! -f "$SSH_KEY" ] && error "Chave SSH não encontrada em $SSH_KEY. Execute: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''"

# ─── GERAR .env DE PRODUCAO A PARTIR DO AMBIENTE ──────────
generate_env() {
  log "Gerando .env de produção a partir do ambiente..."
  ENV_FILE="/tmp/takepay-prod.env"

  cat > "$ENV_FILE" << ENVEOF
NODE_ENV=production
PORT=5000
VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}
VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN}
VITE_FIREBASE_DATABASE_URL=${VITE_FIREBASE_DATABASE_URL:-${FIREBASE_DATABASE_URL}}
VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID:-${FIREBASE_PROJECT_ID}}
VITE_FIREBASE_STORAGE_BUCKET=${VITE_FIREBASE_STORAGE_BUCKET}
VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID}
VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID}
VITE_FIREBASE_MEASUREMENT_ID=${VITE_FIREBASE_MEASUREMENT_ID}
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-take-pay}
FIREBASE_CLIENT_EMAIL=${FIREBASE_CLIENT_EMAIL}
FIREBASE_DATABASE_URL=${FIREBASE_DATABASE_URL:-https://take-pay-default-rtdb.firebaseio.com}
SESSION_SECRET=${SESSION_SECRET}
ADMIN_EMAIL=${ADMIN_EMAIL}
BUNNY_STORAGE_API_KEY=${BUNNY_STORAGE_API_KEY:-}
BUNNY_STORAGE_ZONE_NAME=${BUNNY_STORAGE_ZONE_NAME:-}
EFIBANK_CLIENT_ID=${EFIBANK_CLIENT_ID:-}
EFIBANK_CLIENT_SECRET=${EFIBANK_CLIENT_SECRET:-}
EFIBANK_SANDBOX=${EFIBANK_SANDBOX:-false}
EFIBANK_PIX_KEY=${EFIBANK_PIX_KEY:-}
EFIBANK_PAYEE_CODE=${EFIBANK_PAYEE_CODE:-}
ENVEOF

  # Chaves Firebase têm newlines — adicionar separadamente
  printf 'FIREBASE_PRIVATE_KEY=%s\n' "${FIREBASE_PRIVATE_KEY}" >> "$ENV_FILE"
  printf 'FIREBASE_SERVICE_ACCOUNT_JSON=%s\n' "${FIREBASE_SERVICE_ACCOUNT_JSON}" >> "$ENV_FILE"

  success ".env de produção gerado"
}

# ─── SETUP INICIAL DA VPS ─────────────────────────────────
setup_vps() {
  log "Configurando VPS pela primeira vez (${VPS_IP})..."
  $SSH_CMD $SSH_ACCT@$VPS_IP 'bash -s' << 'REMOTE'
set -e
export DEBIAN_FRONTEND=noninteractive

echo "→ Atualizando sistema..."
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx

echo "→ Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
apt-get install -y -qq nodejs

echo "→ Instalando PM2..."
npm install -g pm2 --silent

echo "→ Criando diretório da aplicação..."
mkdir -p /var/www/takepay /var/www/html

echo "→ Configurando Nginx (apenas se não houver SSL ativo)..."
SSL_CERT="/etc/letsencrypt/live/takepay.com.br/fullchain.pem"

if [ -f "$SSL_CERT" ]; then
  echo "→ SSL já configurado — mantendo Nginx atual intacto."
else
  cat > /etc/nginx/sites-available/takepay << 'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name takepay.com.br www.takepay.com.br;
    client_max_body_size 100M;

    proxy_buffer_size          128k;
    proxy_buffers              4 256k;
    proxy_busy_buffers_size    256k;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/takepay /etc/nginx/sites-enabled/
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  echo "→ Nginx configurado (HTTP)."
fi

echo "→ Configurando PM2 no boot..."
pm2 startup systemd -u root --hp /root 2>/dev/null | grep -E '^sudo|^env' | bash || true

echo "SETUP_OK"
REMOTE
  success "VPS configurada com sucesso"
}

# ─── DEPLOY COMPLETO NA VPS ───────────────────────────────
deploy_vps() {
  log "Iniciando deploy na VPS ${VPS_IP}..."

  generate_env

  log "Criando tarball do projeto..."
  tar -czf /tmp/takepay-src.tar.gz \
    --exclude='./node_modules' \
    --exclude='./.git' \
    --exclude='./dist' \
    --exclude='./.env' \
    --exclude='./.env.*' \
    --exclude='./.deploy' \
    --exclude='./uploads' \
    -C "$SCRIPT_ROOT" .
  SIZE=$(du -sh /tmp/takepay-src.tar.gz | cut -f1)
  success "Tarball criado: ${SIZE}"

  log "Enviando código para VPS..."
  $SCP_CMD /tmp/takepay-src.tar.gz $SSH_ACCT@$VPS_IP:/tmp/takepay-src.tar.gz
  $SCP_CMD /tmp/takepay-prod.env   $SSH_ACCT@$VPS_IP:/tmp/takepay-prod.env
  success "Código enviado"

  log "Extraindo, instalando e fazendo build na VPS..."
  $SSH_CMD $SSH_ACCT@$VPS_IP << REMOTE
set -e
LIVE_DIR="$APP_DIR"
BUILD_DIR="/var/www/takepay-build"

# Matar builds anteriores (NÃO parar o app!)
pkill -f "vite build\|esbuild.*server\|inject-env" 2>/dev/null || true
sleep 1

# ─── FASE 1: Extrair código no diretório de BUILD ───
echo "→ Extraindo código no diretório de build..."
rm -rf \$BUILD_DIR
mkdir -p \$BUILD_DIR
tar -xzf /tmp/takepay-src.tar.gz -C \$BUILD_DIR
rm -f /tmp/takepay-src.tar.gz

# Restaurar .env no build dir
cp /tmp/takepay-prod.env \$BUILD_DIR/.env
rm -f /tmp/takepay-prod.env

# ─── FASE 2: Instalar / reutilizar node_modules ───
echo "→ Verificando dependências..."
LOCK_CHANGED=false
NEW_LOCK_MD5=\$(md5sum \$BUILD_DIR/package-lock.json 2>/dev/null | cut -d' ' -f1 || echo "nolock")

if [ ! -d "\$LIVE_DIR/node_modules" ] || [ ! -d "\$LIVE_DIR/node_modules/vite" ]; then
  LOCK_CHANGED=true
  echo "→ node_modules incompleto — instalando..."
elif [ -f /tmp/takepay-lock-prev.md5 ]; then
  OLD_MD5=\$(cat /tmp/takepay-lock-prev.md5)
  [ "\$NEW_LOCK_MD5" != "\$OLD_MD5" ] && LOCK_CHANGED=true && echo "→ package-lock.json mudou — atualizando deps..."
else
  LOCK_CHANGED=true
  echo "→ Primeira instalação..."
fi

if [ "\$LOCK_CHANGED" = "true" ]; then
  cd \$BUILD_DIR
  npm cache clean --force 2>/dev/null || true
  NODE_ENV=development npm install --prefer-offline 2>&1 | grep -v "TAR_ENTRY_ERROR" | grep -v "^npm warn tar" | tail -5
  echo \$NEW_LOCK_MD5 > /tmp/takepay-lock-prev.md5
else
  echo "→ Reutilizando node_modules existente (deploy rápido)"
  ln -sfn \$LIVE_DIR/node_modules \$BUILD_DIR/node_modules
fi

# ─── FASE 3: Build no BUILD_DIR ───
echo "→ Build completo — LIVE app segue 100% disponível durante o build..."
cd \$BUILD_DIR
NODE_ENV=production npm run build

# ─── FASE 4: Deploy sem janela de erro ───
echo "→ Copiando assets novos para o live..."
mkdir -p \$LIVE_DIR/dist/public/assets

rsync -a \$BUILD_DIR/dist/public/assets/ \$LIVE_DIR/dist/public/assets/ 2>/dev/null || \
  cp -r \$BUILD_DIR/dist/public/assets/* \$LIVE_DIR/dist/public/assets/ 2>/dev/null || true

rsync -a --exclude=assets \$BUILD_DIR/dist/public/ \$LIVE_DIR/dist/public/ 2>/dev/null || \
  cp -r \$BUILD_DIR/dist/public/. \$LIVE_DIR/dist/public/ 2>/dev/null || true

rsync -a --exclude=public \$BUILD_DIR/dist/ \$LIVE_DIR/dist/ 2>/dev/null || \
  cp \$BUILD_DIR/dist/*.js \$BUILD_DIR/dist/*.mjs \$LIVE_DIR/dist/ 2>/dev/null || true

rsync -a --exclude=node_modules --exclude=dist --exclude='.git' \$BUILD_DIR/ \$LIVE_DIR/ 2>/dev/null || true

if [ "\$LOCK_CHANGED" = "true" ] && [ -d "\$BUILD_DIR/node_modules" ] && [ ! -L "\$BUILD_DIR/node_modules" ]; then
  rm -rf \$LIVE_DIR/node_modules
  mv \$BUILD_DIR/node_modules \$LIVE_DIR/node_modules
fi

# ─── FASE 5: Reiniciar PM2 ───
cd \$LIVE_DIR
if pm2 list 2>/dev/null | grep -q "takepay"; then
  pm2 reload takepay --update-env 2>/dev/null || pm2 restart takepay --update-env
else
  NODE_ENV=production pm2 start npm \
    --name takepay \
    --max-memory-restart 768M \
    -- start
fi
pm2 save

# 7. Limpar build temporário em background
rm -rf \$BUILD_DIR &

# ─── FASE 6: Atualizar Nginx se SSL já existir ───
if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
cat > /etc/nginx/sites-available/takepay << NGINXEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};
    return 301 https://${DOMAIN}\\\$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.${DOMAIN};
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    return 301 https://${DOMAIN}\\\$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};
    client_max_body_size 100M;
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;
    proxy_busy_buffers_size 256k;
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files \\\$uri =404;
    }
    location ~* ^/assets/ {
        root /var/www/takepay/dist/public;
        try_files \\\$uri =404;
        add_header Cache-Control 'public, max-age=31536000, immutable';
        add_header X-Content-Type-Options 'nosniff';
    }
    location = / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        add_header Cache-Control 'no-store, must-revalidate' always;
    }
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_cache_bypass \\\$http_upgrade;
        proxy_read_timeout 120s;
        add_header Cache-Control 'no-store, must-revalidate' always;
    }
}
NGINXEOF
fi
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null && echo "→ Nginx recarregado" || echo "→ Nginx reload ignorado"

# Health check
sleep 8
HTTP_LOCAL=\$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000 2>/dev/null || echo "000")

echo ""
echo "========================================"
echo "  Health check local (PM2): HTTP \$HTTP_LOCAL"
if [ "\$HTTP_LOCAL" = "200" ] || [ "\$HTTP_LOCAL" = "302" ] || [ "\$HTTP_LOCAL" = "301" ]; then
  echo "  TAKEPAY ONLINE EM PRODUCAO!"
else
  echo "  AVISO: status \$HTTP_LOCAL (pode ainda estar iniciando)"
  pm2 logs takepay --err --lines 10 --nostream 2>/dev/null | tail -10 || true
fi
echo "  URL: https://$DOMAIN"
echo "========================================"
REMOTE

  # Limpeza local
  rm -f /tmp/takepay-src.tar.gz /tmp/takepay-prod.env
  success "Deploy concluído!"
}

# ─── MAIN ─────────────────────────────────────────────────
MODE="${1:-all}"
echo ""
log "======================================="
log "  TAKEPAY — Deploy [$MODE]"
log "======================================="
echo ""

case "$MODE" in
  vps|all) deploy_vps ;;
  setup)   setup_vps ;;
  *)       echo "Uso: bash deploy.sh [all|vps|setup]"; exit 1 ;;
esac

echo ""
success "======================================="
success "  DEPLOY CONCLUÍDO COM SUCESSO!"
success "  https://$DOMAIN"
success "======================================="
echo ""
