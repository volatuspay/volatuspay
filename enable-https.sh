#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  VolatusPay — Ativar HTTPS em volatuspay.com
#
#  Pré-requisitos:
#    - DNS de volatuspay.com e www.volatuspay.com apontando para 178.105.4.61
#    - certbot já instalado na VPS
#    - nginx rodando na porta 80
#    - chave SSH disponível (padrão: ~/.ssh/id_ed25519)
#
#  Uso:
#    bash enable-https.sh            → verifica DNS e ativa HTTPS
#    bash enable-https.sh --check    → apenas verifica se o DNS propagou
#    bash enable-https.sh --local    → executa direto na VPS (sem SSH)
# ═══════════════════════════════════════════════════════════════════════════
set -e

# ─── CONFIG ───────────────────────────────────────────────────────────────
VPS_IP="178.105.4.61"
SSH_ACCT="root"
DOMAIN="volatuspay.com"
EMAIL="admin@volatuspay.com"
APP_PORT="3000"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=30"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()     { echo -e "${BLUE}[HTTPS]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[AVISO]${NC} $1"; }
error()   { echo -e "${RED}[ERRO]${NC} $1"; exit 1; }

# ─── VERIFICAÇÃO DE DNS ───────────────────────────────────────────────────
check_dns() {
  log "Verificando propagação de DNS para ${DOMAIN}..."

  RESOLVED=$(dig +short "$DOMAIN" @8.8.8.8 2>/dev/null | head -1)
  RESOLVED_WWW=$(dig +short "www.$DOMAIN" @8.8.8.8 2>/dev/null | head -1)

  echo "  → $DOMAIN     resolve para: ${RESOLVED:-'(não resolvido)'}"
  echo "  → www.$DOMAIN resolve para: ${RESOLVED_WWW:-'(não resolvido)'}"

  if [ "$RESOLVED" != "$VPS_IP" ]; then
    warn "$DOMAIN ainda não aponta para $VPS_IP (atual: ${RESOLVED:-nenhum})"
    warn "Aguarde a propagação do DNS antes de prosseguir."
    return 1
  fi

  if [ "$RESOLVED_WWW" != "$VPS_IP" ]; then
    warn "www.$DOMAIN ainda não aponta para $VPS_IP (atual: ${RESOLVED_WWW:-nenhum})"
    warn "O certbot pode falhar para www.$DOMAIN. Considere aguardar."
    return 1
  fi

  success "DNS propagado corretamente para ambos os registros."
  return 0
}

# ─── ATIVAR HTTPS NA VPS (executado remotamente via SSH) ──────────────────
activate_https_remote() {
  log "Conectando à VPS ${VPS_IP}..."

  $SSH_CMD $SSH_ACCT@$VPS_IP 'bash -s' << REMOTE
set -e

DOMAIN="${DOMAIN}"
EMAIL="${EMAIL}"
APP_PORT="${APP_PORT}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()     { echo -e "\${BLUE}[VPS]\${NC} \$1"; }
success() { echo -e "\${GREEN}[OK]\${NC} \$1"; }
warn()    { echo -e "\${YELLOW}[AVISO]\${NC} \$1"; }
err()     { echo -e "\${RED}[ERRO]\${NC} \$1"; exit 1; }

# ─── 1. Verificar pré-requisitos ───────────────────────────────────────────
log "Verificando pré-requisitos na VPS..."
command -v certbot  >/dev/null 2>&1 || err "certbot não encontrado. Instale com: apt install certbot python3-certbot-nginx"
command -v nginx    >/dev/null 2>&1 || err "nginx não encontrado."
command -v pm2      >/dev/null 2>&1 || warn "PM2 não encontrado — assumindo outro gerenciador de processos."
systemctl is-active nginx >/dev/null 2>&1 || err "nginx não está rodando."

SSL_CERT="/etc/letsencrypt/live/\$DOMAIN/fullchain.pem"
if [ -f "\$SSL_CERT" ]; then
  warn "Certificado já existe em \$SSL_CERT"
  warn "Para renovar manualmente: certbot renew --cert-name \$DOMAIN"
  success "HTTPS já está ativo em https://\$DOMAIN"
  exit 0
fi

# ─── 2. Garantir que a pasta de desafio ACME existe ───────────────────────
log "Preparando pasta de desafio ACME..."
mkdir -p /var/www/html/.well-known/acme-challenge
chown -R www-data:www-data /var/www/html 2>/dev/null || true

# ─── 3. Garantir config nginx mínima para HTTP (se ainda não tiver) ────────
NGINX_CONF="/etc/nginx/sites-available/volatuspay"
if [ ! -f "\$NGINX_CONF" ]; then
  log "Criando configuração nginx básica (HTTP) para o certbot..."
  cat > "\$NGINX_CONF" << NGINXHTTP
server {
    listen 80;
    listen [::]:80;
    server_name \$DOMAIN www.\$DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files \\\$uri =404;
    }

    location / {
        proxy_pass http://127.0.0.1:\$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_cache_bypass \\\$http_upgrade;
        proxy_read_timeout 120s;
    }
}
NGINXHTTP
  ln -sf "\$NGINX_CONF" /etc/nginx/sites-enabled/volatuspay
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t || err "Configuração nginx inválida — verifique \$NGINX_CONF"
  systemctl reload nginx
  success "nginx configurado para HTTP."
else
  log "Configuração nginx já existe — mantendo e recarregando..."
  nginx -t || err "Configuração nginx inválida — corrija antes de continuar."
  systemctl reload nginx
fi

# ─── 4. Emitir certificado via certbot ─────────────────────────────────────
log "Emitindo certificado SSL para \$DOMAIN e www.\$DOMAIN..."
certbot --nginx \
  -d "\$DOMAIN" \
  -d "www.\$DOMAIN" \
  --non-interactive \
  --agree-tos \
  -m "\$EMAIL" \
  --redirect \
  --keep-until-expiring \
  2>&1 || err "certbot falhou — verifique se o DNS propagou e se a porta 80 está acessível."

success "Certificado SSL emitido com sucesso!"

# ─── 5. Reescrever nginx com config HTTPS completa e segura ────────────────
log "Atualizando configuração nginx para HTTPS..."
cat > "\$NGINX_CONF" << NGINXSSL
server {
    listen 80;
    listen [::]:80;
    server_name \$DOMAIN www.\$DOMAIN;
    return 301 https://\$DOMAIN\\\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.\$DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/\$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/\$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    return 301 https://\$DOMAIN\\\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name \$DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/\$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/\$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 100M;

    proxy_buffer_size       128k;
    proxy_buffers           4 256k;
    proxy_busy_buffers_size 256k;

    # ACME renewal challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files \\\$uri =404;
    }

    # Assets estáticos com cache longo (se aplicável)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)\$ {
        proxy_pass http://127.0.0.1:\$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        add_header Cache-Control 'public, max-age=31536000, immutable';
    }

    # Aplicação principal
    location / {
        proxy_pass http://127.0.0.1:\$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_cache_bypass \\\$http_upgrade;
        proxy_read_timeout 120s;
    }
}
NGINXSSL

nginx -t || err "Config HTTPS inválida — verifique \$NGINX_CONF"
systemctl reload nginx
success "nginx reconfigurado para HTTPS."

# ─── 6. Verificar renovação automática (systemd timer) ─────────────────────
log "Verificando renovação automática do certificado..."

if systemctl is-enabled certbot.timer >/dev/null 2>&1; then
  success "systemd timer 'certbot.timer' já está ativo."
elif systemctl is-enabled snap.certbot.renew.timer >/dev/null 2>&1; then
  success "snap timer 'snap.certbot.renew.timer' já está ativo (certbot via snap)."
else
  log "Nenhum timer encontrado — configurando certbot.timer via systemd..."
  cat > /etc/systemd/system/certbot.service << 'SVCEOF'
[Unit]
Description=Certbot Renewal
Documentation=file:///usr/share/doc/python3-certbot/README.rst

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --nginx --deploy-hook "systemctl reload nginx"
PrivateTmp=true
SVCEOF

  cat > /etc/systemd/system/certbot.timer << 'TIMEREOF'
[Unit]
Description=Run Certbot twice daily for certificate renewal
Documentation=file:///usr/share/doc/python3-certbot/README.rst

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=43200
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

  systemctl daemon-reload
  systemctl enable certbot.timer
  systemctl start certbot.timer
  success "certbot.timer configurado e ativado."
fi

TIMER_STATUS=\$(systemctl status certbot.timer 2>/dev/null | grep -E 'Active:|Trigger:' | head -2 || echo "(não disponível)")
echo "  \$TIMER_STATUS"

# ─── 7. Simular renovação (dry-run) para validar pipeline ──────────────────
log "Testando pipeline de renovação (dry-run)..."
certbot renew --dry-run --quiet 2>&1 && success "Dry-run de renovação OK." || warn "Dry-run falhou — verifique logs: journalctl -u certbot"

# ─── 8. Health check final ─────────────────────────────────────────────────
log "Verificando HTTPS ao vivo..."
sleep 2
HTTP_CODE=\$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://\$DOMAIN" 2>/dev/null || echo "000")
HTTP_REDIRECT=\$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://\$DOMAIN" 2>/dev/null || echo "000")

echo ""
echo "════════════════════════════════════════════"
echo "  HTTPS status  : \$HTTP_CODE"
echo "  HTTP→HTTPS    : \$HTTP_REDIRECT (esperado: 301)"
if [ "\$HTTP_CODE" = "200" ] || [ "\$HTTP_CODE" = "302" ]; then
  echo "  ✓ HTTPS ATIVO EM https://\$DOMAIN"
else
  echo "  ⚠ Status \$HTTP_CODE — a aplicação pode estar iniciando"
fi
echo "════════════════════════════════════════════"
REMOTE
}

# ─── MODO LOCAL (executa diretamente na VPS sem SSH) ──────────────────────
activate_https_local() {
  DOMAIN="${DOMAIN}"
  EMAIL="${EMAIL}"
  APP_PORT="${APP_PORT}"

  log "Modo --local: executando certbot diretamente nesta máquina (${DOMAIN})..."

  SSL_CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  if [ -f "$SSL_CERT" ]; then
    warn "Certificado já existe."
    success "HTTPS já está ativo."
    exit 0
  fi

  certbot --nginx \
    -d "${DOMAIN}" \
    -d "www.${DOMAIN}" \
    --non-interactive \
    --agree-tos \
    -m "${EMAIL}" \
    --redirect \
    --keep-until-expiring

  systemctl enable certbot.timer 2>/dev/null && systemctl start certbot.timer 2>/dev/null || true
  certbot renew --dry-run --quiet && success "Dry-run OK."
  success "HTTPS ativado em https://${DOMAIN}"
}

# ─── MAIN ─────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  VolatusPay — Ativar HTTPS em ${DOMAIN}"
echo "  VPS: ${VPS_IP}"
echo "═══════════════════════════════════════════════════"
echo ""

case "${1:-}" in
  --check)
    check_dns
    exit $?
    ;;
  --local)
    activate_https_local
    ;;
  *)
    if ! command -v dig >/dev/null 2>&1; then
      warn "'dig' não encontrado — pulando verificação de DNS local."
    else
      if ! check_dns; then
        echo ""
        error "DNS ainda não propagou. Use --check para verificar novamente antes de prosseguir."
      fi
    fi

    [ ! -f "$SSH_KEY" ] && error "Chave SSH não encontrada em ${SSH_KEY}. Defina SSH_KEY=... ou gere com: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''"

    activate_https_remote
    echo ""
    success "═══════════════════════════════════════════"
    success "  HTTPS ATIVADO EM https://${DOMAIN}"
    success "═══════════════════════════════════════════"
    ;;
esac
