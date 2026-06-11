#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  Zen Pagamentos — Deploy Certificados ONZ Finance
#  Copia os certs PROD para o VPS e salva no Firebase RTDB
#  Uso: bash deploy-onz-certs.sh
# ═══════════════════════════════════════════════════════════
set -e

# ─── CONFIG ───────────────────────────────────────────────
VPS_IP="167.235.200.101"
VPS_USER="root"
APP_DIR="/var/www/zenpagamentos"
SCRIPT_ROOT="$(cd "$(dirname "$0")" && pwd)"
SSH_KEY="${SCRIPT_ROOT}/.deploy/zen_key"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no"

# Caminhos locais dos certs extraídos
LOCAL_CERTS="${SCRIPT_ROOT}/../attached_assets/onz-certs/Certificados/BASSPAGO/PROD"
QRCODES_DIR="${LOCAL_CERTS}/QRCODES-MTLS"
ACCOUNTS_DIR="${LOCAL_CERTS}/ACCOUNTS"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()     { echo -e "${BLUE}[ONZ CERTS]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
error()   { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

[ ! -f "$SSH_KEY" ] && error "SSH key não encontrada: $SSH_KEY"
[ ! -f "${QRCODES_DIR}/BASSPAGO_77.crt" ] && error "Cert QRCodes não encontrado: ${QRCODES_DIR}/BASSPAGO_77.crt"
[ ! -f "${QRCODES_DIR}/BASSPAGO_77.key" ] && error "Key QRCodes não encontrada: ${QRCODES_DIR}/BASSPAGO_77.key"
[ ! -f "${ACCOUNTS_DIR}/BASSPAGO_77.crt" ] && error "Cert Accounts não encontrado: ${ACCOUNTS_DIR}/BASSPAGO_77.crt"
[ ! -f "${ACCOUNTS_DIR}/BASSPAGO_77.key" ] && error "Key Accounts não encontrada: ${ACCOUNTS_DIR}/BASSPAGO_77.key"

log "📦 Enviando certificados ONZ Finance para VPS..."

# Criar diretório de certs no VPS
$SSH_CMD ${VPS_USER}@${VPS_IP} "mkdir -p ${APP_DIR}/certs/onz/qrcodes ${APP_DIR}/certs/onz/accounts && chmod 700 ${APP_DIR}/certs/onz"

# Copiar certs QRCodes (Cash-in)
$SCP_CMD "${QRCODES_DIR}/BASSPAGO_77.crt" "${VPS_USER}@${VPS_IP}:${APP_DIR}/certs/onz/qrcodes/BASSPAGO_77.crt"
$SCP_CMD "${QRCODES_DIR}/BASSPAGO_77.key" "${VPS_USER}@${VPS_IP}:${APP_DIR}/certs/onz/qrcodes/BASSPAGO_77.key"
$SCP_CMD "${QRCODES_DIR}/BASSPAGO_77.pfx" "${VPS_USER}@${VPS_IP}:${APP_DIR}/certs/onz/qrcodes/BASSPAGO_77.pfx"

# Copiar certs Accounts (Cash-out)
$SCP_CMD "${ACCOUNTS_DIR}/BASSPAGO_77.crt" "${VPS_USER}@${VPS_IP}:${APP_DIR}/certs/onz/accounts/BASSPAGO_77.crt"
$SCP_CMD "${ACCOUNTS_DIR}/BASSPAGO_77.key" "${VPS_USER}@${VPS_IP}:${APP_DIR}/certs/onz/accounts/BASSPAGO_77.key"
$SCP_CMD "${ACCOUNTS_DIR}/BASSPAGO_77.pfx" "${VPS_USER}@${VPS_IP}:${APP_DIR}/certs/onz/accounts/BASSPAGO_77.pfx"

success "Certificados copiados para VPS!"

# Ajustar permissões dos arquivos .key (privados)
$SSH_CMD ${VPS_USER}@${VPS_IP} "chmod 600 ${APP_DIR}/certs/onz/qrcodes/BASSPAGO_77.key ${APP_DIR}/certs/onz/accounts/BASSPAGO_77.key"

log "🔥 Salvando certificados no Firebase RTDB (eterno)..."

# Executar script de save no VPS usando ts-node
$SSH_CMD ${VPS_USER}@${VPS_IP} "cd ${APP_DIR} && node -e \"
const fs = require('fs');
const admin = require('firebase-admin');
require('dotenv').config();

const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\\\n/g, '\\n');
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey,
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const rtdb = admin.database();

const qrcodesCert  = fs.readFileSync('${APP_DIR}/certs/onz/qrcodes/BASSPAGO_77.crt');
const qrcodesKey   = fs.readFileSync('${APP_DIR}/certs/onz/qrcodes/BASSPAGO_77.key');
const accountsCert = fs.readFileSync('${APP_DIR}/certs/onz/accounts/BASSPAGO_77.crt');
const accountsKey  = fs.readFileSync('${APP_DIR}/certs/onz/accounts/BASSPAGO_77.key');

const cashInSecret  = process.env.ONZ_CASH_IN_SECRET  || 'KA3WJttE9phd3ULpfa8bmv8xgfNqoGz7_24tapjgFQuVzN-BAPzEQ--s2i';
const cashOutSecret = process.env.ONZ_CASH_OUT_SECRET || 'fL_JsMDzy7eMYojt9xqstVb7ra*iqW.xfrocqGM2L_xnzFNN4NjZ@AYzUtRM';
const pixKey        = process.env.ONZ_PIX_KEY || '';

rtdb.ref('tetri-system/onz-finance').set({
  certs: {
    qrcodes: {
      cert: qrcodesCert.toString('base64'),
      key:  qrcodesKey.toString('base64'),
      savedAt: new Date().toISOString(),
    },
    accounts: {
      cert: accountsCert.toString('base64'),
      key:  accountsKey.toString('base64'),
      savedAt: new Date().toISOString(),
    },
    eternal: true, version: 'PROD', partner: 'BASSPAGO_77',
  },
  credentials: {
    cashInClientId:     'BASSPAGO_77',
    cashInClientSecret: cashInSecret,
    cashOutClientId:    'BASSPAGO_77',
    cashOutClientSecret:cashOutSecret,
    pixKey:             pixKey,
    environment:        'production',
    enabled:            true,
    savedAt:            new Date().toISOString(),
    eternal:            true,
  },
}).then(() => {
  console.log('✅ Certificados e credenciais ONZ Finance salvos ETERNAMENTE no Firebase RTDB!');
  process.exit(0);
}).catch(e => { console.error('❌', e.message); process.exit(1); });
\""

success "🎉 Certificados ONZ Finance salvos ETERNAMENTE no Firebase RTDB!"
log "Path RTDB: tetri-system/onz-finance/certs"
log "Path RTDB: tetri-system/onz-finance/credentials"
echo ""
echo -e "${YELLOW}⚠️  PRÓXIMO PASSO: Configure a chave PIX de recebimento ONZ no Admin > Pagamentos > Chaves > ONZ Finance${NC}"
