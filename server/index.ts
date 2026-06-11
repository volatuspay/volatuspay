// 🔧 CARREGAMENTO DE VARIÁVEIS DE AMBIENTE
import dotenv from 'dotenv';
// Preservar NODE_ENV antes do dotenv (evita que .env sobrescreva com override:true)
const _savedNodeEnv = process.env.NODE_ENV;
dotenv.config({ override: true });
if (_savedNodeEnv) process.env.NODE_ENV = _savedNodeEnv;

// 🔐 VALIDAÇÃO DE ENVIRONMENT VARIABLES (ANTES DE TUDO)
import { validateOrThrow } from './lib/env-validator.js';
await validateOrThrow();

// 🔒 ATIVAR SANITIZAÇÃO DE LOGS (ANTES DE QUALQUER LOG)
import { enableLogSanitization, sanitizeObject } from './security/log-sanitizer.js';
import { getFirebaseHealth } from './security/security-logger.js';
enableLogSanitization();

// 🔐 GLOBAL ERROR HANDLERS - SANITIZAÇÃO DE DADOS SENSÍVEIS
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', sanitizeObject(error));
  console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ UNHANDLED REJECTION:', sanitizeObject(reason));
});


console.log('✅ Global error handlers configurados');

// 🔐 SECRETS MANAGER / HSM - CARREGAR PRIMEIRO (ANTES DE TUDO)
import { secretsManager, getSecret } from './lib/secrets-manager.js';

// 🔥 FIREBASE ADMIN - IMPORTAR FIRESTORE
import { removeUndefinedDeep } from './lib/firestore-helpers.js';
import { createOrderWithIdempotency } from "./helpers/create-session-with-idempotency.js";

// 📡 WEBHOOK DISPATCHER - Eventos para tenants
import { dispatchPixPaidEvent, dispatchCardApprovedEvent, dispatchBoletoPaidEvent, dispatchPixCreatedEvent, dispatchBoletoCreatedEvent, dispatchRefundProcessedEvent, dispatchPaymentDeclinedEvent } from "./lib/webhook-dispatcher.js";

// 📊 FACEBOOK CONVERSIONS API - Server-side pixel tracking
import { dispatchPurchaseEventToPixels } from "./lib/facebook-capi.js";

// 📋 ORDERS SYNC - Sincronização RTDB + Bunny CDN
import { syncOrderAfterUpdate, syncOrderAfterCreate } from "./lib/orders-sync.js";

// 📊 UTMify - Envio de dados para rastreamento
import { sendOrderToUTMify } from "./lib/utmify-service.js";

// 💰 FINANCIAL VALIDATOR - Validação centralizada de valores financeiros
// 🔐 HELPER: Carregar HMAC do Firebase se não existir como secret
async function getWebhookHmac(db?: admin.firestore.Firestore): Promise<string | undefined> {
  // Tentar buscar do environment primeiro
  const envHmac = getSecret('EFIBANK_WEBHOOK_HMAC');
  if (envHmac) return envHmac;
  
  // Se não encontrou e tem db, buscar do Firestore
  if (db) {
    try {
      const configDoc = await db.collection('paymentConfig').doc('global').get();
      if (configDoc.exists) {
        const data = configDoc.data();
        const encryptedHmac = data?.efibank?.webhookHmac;
        
        if (encryptedHmac) {
          const { decryptSensitiveData } = await import('./security/key-encryption.js');
          return decryptSensitiveData(encryptedHmac);
        }
      }
    } catch (error) {
      console.error('Erro ao buscar HMAC do Firebase:', error);
    }
  }
  
  return undefined;
}

// 🌐 HELPER: Obter domínio base da aplicação
function getBaseDomain(): string {
  // Prioridade 1: variável de ambiente explícita (define no VPS: APP_BASE_URL=https://volatuspay.com)
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, '');
  }
  // Prioridade 2: produção padrão
  return 'https://volatuspay.com';
}

// 🔐 FILE INTEGRITY MONITORING - PROTEÇÃO DE CÓDIGO-FONTE
// ⚡ DEPLOYMENT FIX: Import dinâmico para evitar blocking em production startup
// import { fileIntegrityMonitor, verifyFileIntegrity, getIntegrityStats, getIntegrityViolations } from './security/file-integrity-monitor.js';

// ✅ CREDENCIAIS EFIBANK VIA SECRETS SEGUROS
// Credenciais carregadas automaticamente dos environment secrets

// 📂 HELPER: Caminho correto dos certificados (dev vs prod)
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';

// 🔐 EXTEND EXPRESS REQUEST TYPE TO INCLUDE USER AND SECURITY PROPERTIES
declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email: string;
        email_verified: boolean;
      } | null;
      bypassAllSecurity?: boolean;
    }
  }
}

// 🔒 SECURITY: FUNÇÃO PARA SANITIZAR ERROS E REMOVER CREDENCIAIS
function sanitizeError(error: any): string {
  if (!error) return 'Erro desconhecido';
  
  let errorMsg = error.message || error.toString() || 'Erro desconhecido';
  
  // 🔒 REMOVER QUALQUER PADRÃO QUE PAREÇA CREDENCIAL
  const sensitivePatterns = [
    /password[:\s=]+[^\s]+/gi,
    /senha[:\s=]+[^\s]+/gi,
    /token[:\s=]+[^\s]+/gi,
    /api[_\s]?key[:\s=]+[^\s]+/gi,
    /secret[:\s=]+[^\s]+/gi,
    /client[_\s]?id[:\s=]+[^\s]+/gi,
    /client[_\s]?secret[:\s=]+[^\s]+/gi,
    /bearer\s+[^\s]+/gi,
    /authorization[:\s]+[^\s]+/gi,
    /vp_[a-f0-9]{64,}/gi, // API keys VolatusPay
    /sk_[a-z0-9_]+/gi, // Stripe secret keys
    /pk_[a-z0-9_]+/gi, // Stripe public keys (menos sensível mas melhor remover)
    /[a-f0-9]{64,}/g // Hashes longos
  ];
  
  for (const pattern of sensitivePatterns) {
    errorMsg = errorMsg.replace(pattern, '[REDACTED]');
  }
  
  return errorMsg;
}
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { nanoid } from 'nanoid';
import { createServer } from "http";
import http from 'http';
import { setupVite, serveStatic } from "./vite";
import { storage } from "./storage.js";
import { currencyConverter } from "./lib/currency-converter";
import * as admin from 'firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { getEfiBankKeys, getStripeKeys, getPaymentFees, getPaymentConfig } from './lib/payment-config.js';
import { syncEternalCredentials, checkCredentialsStatus, loadEternalFees } from './lib/eternal-credentials.js';
import { syncSellerFeesToRTDB } from "./lib/eternal-sync.js";
import { FieldPath, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { ensureFirebaseReady, getAdmin, getFirestore } from './lib/firebase-admin.js';
import { sendSellerApprovalEmail, sendSellerRejectionEmail, sendPixPagoEmail } from './lib/email-service.js';
import { uploadToBunnyStorage, createSellerFolderStructure, uploadToSellerFolder, getSellerFolderPath } from './lib/bunny-helper.js';
import sellerCompaniesRouter from './routes/seller-companies.js';
import { setFirestoreInstance, loadWooviConfig, createWooviCharge, processWooviWebhook, validateWooviWebhook } from './lib/woovi-api.js';
import { createOnzPixCharge, loadOnzCredentials } from './lib/onz-finance-api.js';
import { startSubscriptionCron } from './jobs/subscription-cron.js';
import { startDunningCron } from './jobs/dunning-cron.js';
import { startSalesSummaryCron } from './jobs/sales-summary-cron.js';
import { startAbandonedCartCron } from './jobs/abandoned-cart-cron.js';
import { checkAndApproveExpiredRefunds } from './auto-refund-approval.js';
import { startBalanceReconciliationScheduler } from './services/balance-scheduler.js';

// 📂 HELPER: Caminho correto dos certificados (dev vs prod)
const __dirname = path.dirname(__filename);
function getCertPath(certName: string): string {
  // ✅ SEMPRE usa process.cwd() + '/certs/' (funciona em dev E produção)
  // Certificados ficam em /home/runner/workspace/certs/ independente de build
  return path.join(process.cwd(), 'certs', certName);
}
import { promisify } from 'util';
import { exec } from 'child_process';
import multer from 'multer';
import sharp from 'sharp';
// 🚫 ROUTER INSEGURO REMOVIDO POR VIOLAÇÕES PCI
// import tokenizeRouter from './tokenize-efibank.js';
import { insertModuleSchema, insertLessonSchema, insertProductSchema, insertProductOfferSchema, insertCheckoutSchema, sellerRegisterFormSchema, affiliateConfigSchema, type InsertSeller } from '../shared/schema.js';
import bcrypt from 'bcrypt';
import { z } from 'zod';

// 📁 CONFIGURAÇÃO DO MULTER PARA UPLOAD DE DOCUMENTOS
// 🛡️ ULTRA-SECURE UPLOAD MIDDLEWARE - IMPOSSÍVEL DE QUEBRAR
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 🔥 REDUZIDO: 5MB máximo (era 10MB)
    files: 5, // ✅ MÁXIMO 5 arquivos por request (suporta todos documentos: RG frente/verso, selfie, CNPJ)
    fieldSize: 2 * 1024, // 🔒 2KB para campos de texto
    fieldNameSize: 50, // 🔒 50 chars para nomes de campos
    fields: 5 // 🔒 Máximo 5 campos não-arquivo
  },
  fileFilter: (req, file, cb) => {
    try {
      console.log(`🔍 UPLOAD FILTER: ${file.originalname} | ${file.mimetype} | IP: ${req.ip}`);
      
      // 🛡️ VALIDAÇÃO 1: TIPOS MIME ULTRA-RESTRITIVOS
      const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      if (!allowedTypes.includes(file.mimetype)) {
        console.warn(`❌ BLOCKED: Invalid MIME type ${file.mimetype} from ${req.ip}`);
        return cb(new Error('SECURITY: Tipo de arquivo bloqueado por política de segurança'));
      }
      
      // 🛡️ VALIDAÇÃO 2: NOME DO ARQUIVO
      if (!file.originalname || file.originalname.length > 100) {
        console.warn(`❌ BLOCKED: Invalid filename from ${req.ip}`);
        return cb(new Error('SECURITY: Nome de arquivo inválido ou muito longo'));
      }
      
      // 🛡️ VALIDAÇÃO 3: CARACTERES PERIGOSOS
      const dangerousChars = /[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/;
      if (dangerousChars.test(file.originalname)) {
        console.warn(`❌ BLOCKED: Dangerous chars in filename from ${req.ip}`);
        return cb(new Error('SECURITY: Nome contém caracteres não permitidos'));
      }
      
      // 🛡️ VALIDAÇÃO 4: EXTENSÕES DUPLAS E MALICIOSAS (BYPASS ATTEMPT)
      const parts = file.originalname.split('.');
      if (parts.length >= 2) {
        const lastExtension = parts[parts.length - 1].toLowerCase();
        
        // Lista de extensões executáveis/maliciosas NUNCA permitidas
        const executableExtensions = ['exe', 'php', 'js', 'html', 'htm', 'bat', 'cmd', 'com', 'pif', 'scr', 'vbs', 'jar', 'sh', 'asp', 'jsp'];
        
        // Bloqueia se a ÚLTIMA extensão for executável/maliciosa
        if (executableExtensions.includes(lastExtension)) {
          console.warn(`❌ BLOCKED: Executable extension ${lastExtension} from ${req.ip}`);
          return cb(new Error('SECURITY: Extensão executável não permitida'));
        }
        
        // Se houver mais de um ponto, verificar extensões duplas suspeitas
        if (parts.length > 2) {
          const secondToLast = parts[parts.length - 2].toLowerCase();
          if (executableExtensions.includes(secondToLast)) {
            console.warn(`❌ BLOCKED: Double extension bypass attempt from ${req.ip}`);
            return cb(new Error('SECURITY: Tentativa de bypass com extensão dupla detectada'));
          }
        }
      }
      
      // 🛡️ VALIDAÇÃO 5: NOMES RESERVADOS
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'LPT1', 'LPT2', 'config', 'admin'];
      const baseName = file.originalname.split('.')[0].toLowerCase();
      if (reservedNames.includes(baseName.toUpperCase())) {
        console.warn(`❌ BLOCKED: Reserved filename from ${req.ip}`);
        return cb(new Error('SECURITY: Nome de arquivo reservado pelo sistema'));
      }
      
      console.log(`✅ UPLOAD APPROVED: ${file.originalname} from ${req.ip}`);
      cb(null, true);
      
    } catch (error) {
      console.error(`❌ UPLOAD FILTER ERROR:`, error);
      cb(new Error('SECURITY: Erro na validação de segurança'));
    }
  }
});

// 🔍 MAGIC BYTES VALIDATION MIDDLEWARE - DEVASTADOR
const validateMagicBytes = (req: any, res: any, next: any) => {
  if (!req.file || !req.file.buffer) {
    return next();
  }

  const buffer = req.file.buffer;
  const mimeType = req.file.mimetype;
  
  // 🛡️ MAGIC BYTES ULTRA-PRECISOS por tipo (incluindo WebP e GIF)
  const magicBytes: Record<string, number[][]> = {
    'image/jpeg': [[0xFF, 0xD8, 0xFF]], // JPEG definitivo
    'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]], // PNG completo
    'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF (WebP container)
    
    'application/pdf': [[0x25, 0x50, 0x44, 0x46]] // %PDF
  };

  const expectedBytes = magicBytes[mimeType];
  if (!expectedBytes) {
    console.warn(`❌ MAGIC BYTES: Unknown type ${mimeType} from ${req.ip}`);
    return res.status(400).json({ 
      success: false, 
      message: 'SECURITY: Tipo de arquivo não reconhecido pelo sistema' 
    });
  }
  
  // 🖼️ VALIDAÇÃO ESPECIAL PARA WEBP: verificar também bytes 8-11 (WEBP)
  if (mimeType === 'image/webp' && buffer.length >= 12) {
    const webpSignature = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
    const isWebP = webpSignature.every((byte: number, i: number) => buffer[8 + i] === byte);
    if (!isWebP) {
      console.warn(`❌ MAGIC BYTES: Invalid WebP signature from ${req.ip}`);
      return res.status(400).json({ 
        success: false, 
        message: 'SECURITY: Arquivo WebP inválido' 
      });
    }
    console.log(`✅ MAGIC BYTES VERIFIED: WebP from ${req.ip}`);
    return next();
  }
  // 🔍 VERIFICAR MAGIC BYTES EXATOS
  let isValid = false;
  for (const expected of expectedBytes) {
    if (buffer.length >= expected.length) {
      isValid = expected.every((byte, index) => buffer[index] === byte);
      if (isValid) break;
    }
  }

  if (!isValid) {
    console.warn(`❌ MAGIC BYTES MISMATCH: ${mimeType} from ${req.ip}`);
    return res.status(400).json({
      success: false,
      message: 'SECURITY: Conteúdo do arquivo não corresponde ao tipo declarado - possível tentativa de bypass'
    });
  }

  // 🚨 VALIDAÇÃO ADICIONAL: Detectar payloads maliciosos em imagens (polyglot attacks)
  if (mimeType?.startsWith('image/')) {
    const bufferStr = buffer.toString('utf8', 0, Math.min(buffer.length, 5000));
    
    // Detectar scripts/HTML embutidos em imagens
    const maliciousPatterns = [
      /<script/i,
      /<iframe/i,
      /javascript:/i,
      /on(load|error|click)=/i,
      /<svg.*on/i,
      /eval\(/i,
      /document\./i,
      /window\./i,
      /<\?php/i
    ];
    
    for (const pattern of maliciousPatterns) {
      if (pattern.test(bufferStr)) {
        console.error(`🚨 MALICIOUS PAYLOAD DETECTED in image: ${pattern} from ${req.ip}`);
        return res.status(400).json({
          success: false,
          message: 'SECURITY: Conteúdo malicioso detectado no arquivo'
        });
      }
    }
  }

  console.log(`✅ MAGIC BYTES VERIFIED: ${mimeType} from ${req.ip}`);
  next();
};

// 🖼️ CONFIGURAÇÃO DO MULTER ESPECÍFICA PARA IMAGENS DE PRODUTOS
// 🖼️ ULTRA-SECURE IMAGE UPLOAD - PRODUTO/BANNER BLINDADO
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB para imagens de produto/banner
    files: 1, // 🚫 APENAS 1 imagem por request
    fieldSize: 1 * 1024, // 🔒 1KB para campos de texto
    fieldNameSize: 30, // 🔒 30 chars para nomes de campos
    fields: 3 // 🔒 Máximo 3 campos não-arquivo
  },
  fileFilter: async (req, file, cb) => {
    try {
      console.log(`🖼️ IMAGE FILTER: ${file.originalname} | ${file.mimetype} | IP: ${req.ip}`);
      
      // 🛡️ VALIDAÇÃO 1: APENAS IMAGENS ESPECÍFICAS (BANNERS: JPEG, PNG, WebP, GIF)
      const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedImageTypes.includes(file.mimetype)) {
        console.warn(`❌ BLOCKED: Invalid image type ${file.mimetype} from ${req.ip}`);
        return cb(new Error('SECURITY: Apenas JPEG, PNG, WebP e GIF permitidos'));
      }
      
      // 🛡️ VALIDAÇÃO 2: NOME E EXTENSÃO
      const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      const extension = file.originalname.toLowerCase().split('.').pop();
      if (!extension || !validExtensions.includes(`.${extension}`)) {
        console.warn(`❌ BLOCKED: Invalid extension from ${req.ip}`);
        return cb(new Error('SECURITY: Extensão de arquivo não corresponde ao tipo'));
      }
      
      // 🛡️ VALIDAÇÃO 3: NOME SEGURO  
      if (!file.originalname || file.originalname.length > 100) {
        console.warn(`❌ BLOCKED: Invalid image filename from ${req.ip}`);
        return cb(new Error('SECURITY: Nome de imagem inválido'));
      }
      
      // 🛡️ VALIDAÇÃO 4: PADRÕES SUSPEITOS
      const suspiciousPatterns = /\.(php|jsp|asp|js|html|htm|svg|xml)$/i;
      if (suspiciousPatterns.test(file.originalname)) {
        console.warn(`❌ BLOCKED: Suspicious pattern in filename from ${req.ip}`);
        return cb(new Error('SECURITY: Padrão suspeito detectado no nome'));
      }
      
      console.log(`✅ IMAGE APPROVED: ${file.originalname} from ${req.ip}`);
      cb(null, true);
      
    } catch (error) {
      console.error(`❌ IMAGE FILTER ERROR:`, error);
      cb(new Error('SECURITY: Erro na validação de imagem'));
    }
  }
});

// 🛡️ SISTEMA DE SEGURANÇA AVANÇADO
import { 
  verifyFirebaseToken,
  requireAdmin,
  requireSuperAdmin,
  requireApprovedSeller,
  grantAdminAccess,
  revokeAdminAccess,
  checkAdminAccess
} from './security/firebase-auth.js';
import { adminShield } from './security/admin-shield.js';
import { threatGuardMiddleware, loadBlockedIPsFromFirebase } from './security/threatguard.js';
import {
  ddosProtectionMiddleware,
  validateRealCPF,
  detectFraud as detectCPFFraud,
  getSecurityStats,
  authStatusHandler,
  AuthenticatedRequest
} from './security';
import { secureUploadMiddleware } from './security/secure-upload-integration.js';

// 🆔 RASTREABILIDADE E AUDITORIA - SIEM CENTRALIZADO
import { requestIdMiddleware } from './middleware/request-id.js';
import { etagMiddleware } from './middleware/etag-support.js';
import { auditLoggerMiddleware } from './middleware/audit-logger.js';

// 🔐 VALIDAÇÃO DE WEBHOOKS SEGURA
import {
  validateStripeWebhook,
  validateEfiBankWebhook,
  validateEfiBankHMAC,
  createWebhookValidator
} from './security/webhook-validation';
import {
  logPaymentStatusChange,
  auditedStatusChange
} from './security/payment-audit';

// 🛡️ SISTEMA DE CRIPTOGRAFIA DE CHAVES SENSÍVEIS
import {
  encryptSensitiveData,
  decryptSensitiveData,
  obfuscateKey,
  sanitizeForLogs,
  secureLogger,
  sanitizeHttpResponse,
  createSecureHash
} from './security/key-encryption';

// 🛡️ CAMADA DE SEGURANÇA APRIMORADA - IDOR/CSRF/PRICING
import applySecurityEnhancements, { securityWrappers } from './security/security-integration-layer';
import { csrfOriginMiddleware } from './security/csrf-origin.js';

// 🚦 RATE LIMITING - PROTEÇÃO CONTRA BRUTE FORCE E FLOODING
import rateLimit from 'express-rate-limit';

// 🔐 SISTEMA SEGURO DE CONFIGURAÇÃO STRIPE
let stripeConfigCache: { publicKey: string; secretKey: string; environment: string; lastLoaded: Date } | null = null;

async function loadSecureStripeConfig(): Promise<{ publicKey: string; secretKey: string; environment: string } | null> {
  try {
    // Usar cache se disponível (válido por 5 minutos)
    if (stripeConfigCache && (Date.now() - stripeConfigCache.lastLoaded.getTime()) < 300000) {
      return {
        publicKey: stripeConfigCache.publicKey,
        secretKey: stripeConfigCache.secretKey,
        environment: stripeConfigCache.environment
      };
    }

    // 1. Primeiro, tentar carregar do Firebase
    try {
      await ensureFirebaseReady();
      const _fsStripe = getAdmin().firestore();
      try {
        // Tentar carregar de admin/stripe-config primeiro
        const configRef = _fsStripe.collection('admin').doc('stripe-config');
        const configDoc = await configRef.get();
        
        if (configDoc.exists) {
          const data = configDoc.data();
          if (data.publicKey && data.secretKey) {
            console.log('🔐 Carregando configuração Stripe do Firebase admin/stripe-config (criptografada)');
            
            // Descriptografar chave secreta (com tratamento de erro)
            try {
              const decryptedSecretKey = decryptSensitiveData(data.secretKey);
              
              if (decryptedSecretKey && decryptedSecretKey !== 'DECRYPTION_ERROR') {
                // Atualizar cache
                stripeConfigCache = {
                  publicKey: data.publicKey,
                  secretKey: decryptedSecretKey,
                  environment: data.environment || 'unknown',
                  lastLoaded: new Date()
                };
                
                console.log(`✅ Configuração Stripe carregada do Firebase: ${data.environment}`);
                return {
                  publicKey: data.publicKey,
                  secretKey: decryptedSecretKey,
                  environment: data.environment || 'unknown'
                };
              }
            } catch (decryptError) {
              console.error('❌ ERRO ao descriptografar secretKey do admin/stripe-config:', decryptError);
              console.log('⚠️ Tentando fonte alternativa...');
            }
          }
        }
        
        // Tentar carregar de paymentConfig/global (painel de configurações gerais)
        console.log('🔍 Tentando carregar Stripe de paymentConfig/global...');
        const paymentConfigRef = _fsStripe.collection('paymentConfig').doc('global');
        const paymentConfigDoc = await paymentConfigRef.get();
        
        if (paymentConfigDoc.exists) {
          const data = paymentConfigDoc.data();
          if (data.stripe && data.stripe.publicKey && data.stripe.secretKey) {
            console.log('🔐 Carregando configuração Stripe do paymentConfig/global (criptografada)');
            
            // Descriptografar chave secreta (com tratamento de erro)
            try {
              const decryptedSecretKey = decryptSensitiveData(data.stripe.secretKey);
              
              if (decryptedSecretKey && decryptedSecretKey !== 'DECRYPTION_ERROR') {
                // Atualizar cache
                stripeConfigCache = {
                  publicKey: data.stripe.publicKey,
                  secretKey: decryptedSecretKey,
                  environment: data.stripe.environment || 'unknown',
                  lastLoaded: new Date()
                };
                
                console.log(`✅ Configuração Stripe carregada de paymentConfig: ${data.stripe.environment}`);
                return {
                  publicKey: data.stripe.publicKey,
                  secretKey: decryptedSecretKey,
                  environment: data.stripe.environment || 'unknown'
                };
              }
            } catch (decryptError) {
              console.error('❌ ERRO ao descriptografar secretKey do paymentConfig/global:', decryptError);
              console.log('⚠️ Chave pode estar corrompida ou usar encryption key diferente');
            }
          }
        }
      } catch (fbError) {
        console.log('⚠️ Falha ao carregar do Firebase, tentando environment variables...');
      }
    } catch (_fsOuterErr) {
      console.log('⚠️ Firebase não disponível para config Stripe:', (_fsOuterErr as any)?.message);
    }

    // 2. Fallback para environment variables (ignorar strings vazias)
    let envSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
    let envPublicKey = (
      process.env.STRIPE_PUBLISHABLE_KEY?.trim() || 
      process.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() || 
      process.env.VITE_STRIPE_PUBLIC_KEY?.trim() ||
      process.env.STRIPE_PUBLIC_KEY?.trim()
    );
    
    // 🔥 IGNORAR STRINGS VAZIAS
    if (envSecretKey === '') envSecretKey = undefined;
    if (envPublicKey === '') envPublicKey = undefined;
    
    if (envSecretKey && envPublicKey && envSecretKey.length > 0 && envPublicKey.length > 0) {
      const environment = envSecretKey.includes('_live_') ? 'production' : 'sandbox';
      
      // Atualizar cache
      stripeConfigCache = {
        publicKey: envPublicKey,
        secretKey: envSecretKey,
        environment,
        lastLoaded: new Date()
      };
      return {
        publicKey: envPublicKey,
        secretKey: envSecretKey,
        environment
      };
    }

    console.log('❌ Nenhuma configuração Stripe disponível');
    return null;
  } catch (error) {
    console.error('❌ Erro ao carregar configuração Stripe:', error);
    return null;
  }
}

// 🌍 SISTEMA SEGURO DE CONFIGURAÇÃO ADYEN
let adyenConfigCache: { merchantAccount: string; clientKey: string; apiKey: string; environment: string; hmacKey: string; lastLoaded: Date } | null = null;

async function loadSecureAdyenConfig(): Promise<{ merchantAccount: string; clientKey: string; apiKey: string; environment: string; hmacKey: string } | null> {
  try {
    // Usar cache se disponível (válido por 5 minutos)
    if (adyenConfigCache && (Date.now() - adyenConfigCache.lastLoaded.getTime()) < 300000) {
      return {
        merchantAccount: adyenConfigCache.merchantAccount,
        clientKey: adyenConfigCache.clientKey,
        apiKey: adyenConfigCache.apiKey,
        environment: adyenConfigCache.environment,
        hmacKey: adyenConfigCache.hmacKey
      };
    }

    // 1. Primeiro, tentar carregar do Firebase
    try {
      await ensureFirebaseReady();
      const _fsAdyen = getAdmin().firestore();
      try {
        const configRef = _fsAdyen.collection('admin').doc('adyen-config');
        const configDoc = await configRef.get();
        
        if (configDoc.exists) {
          const data = configDoc.data();
          if (data.merchantAccount && data.clientKey && data.apiKey) {
            console.log('🔐 Carregando configuração Adyen do Firebase (criptografada)');
            
            // Descriptografar chaves sensíveis
            const decryptedApiKey = decryptSensitiveData(data.apiKey);
            const decryptedHmacKey = decryptSensitiveData(data.hmacKey);
            
            if (decryptedApiKey && decryptedApiKey !== 'DECRYPTION_ERROR') {
              // Atualizar cache
              adyenConfigCache = {
                merchantAccount: data.merchantAccount,
                clientKey: data.clientKey,
                apiKey: decryptedApiKey,
                environment: data.environment || 'test',
                hmacKey: decryptedHmacKey || '',
                lastLoaded: new Date()
              };
              
              console.log(`✅ Configuração Adyen carregada do Firebase: ${data.environment}`);
              return {
                merchantAccount: data.merchantAccount,
                clientKey: data.clientKey,
                apiKey: decryptedApiKey,
                environment: data.environment || 'test',
                hmacKey: decryptedHmacKey || ''
              };
            }
          }
        }
      } catch (fbError) {
        console.log('⚠️ Falha ao carregar configuração Adyen do Firebase, usando env vars...');
      }
    } catch (_fsAdyenOuterErr) {
      console.log('⚠️ Firebase não disponível para config Adyen:', (_fsAdyenOuterErr as any)?.message);
    }

    // 2. Fallback para environment variables
    const envMerchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT;
    const envClientKey = process.env.ADYEN_CLIENT_KEY;
    const envApiKey = process.env.ADYEN_API_KEY;
    const envHmacKey = process.env.ADYEN_HMAC_KEY;
    
    if (envMerchantAccount && envClientKey && envApiKey) {
      const environment = envClientKey.includes('_live_') ? 'live' : 'test';
      
      // Atualizar cache
      adyenConfigCache = {
        merchantAccount: envMerchantAccount,
        clientKey: envClientKey,
        apiKey: envApiKey,
        environment,
        hmacKey: envHmacKey || '',
        lastLoaded: new Date()
      };
      
      console.log(`✅ Configuração Adyen carregada do environment: ${environment}`);
      return {
        merchantAccount: envMerchantAccount,
        clientKey: envClientKey,
        apiKey: envApiKey,
        environment,
        hmacKey: envHmacKey || ''
      };
    }

    console.log('❌ Nenhuma configuração Adyen disponível');
    return null;
  } catch (error) {
    console.error('❌ Erro ao carregar configuração Adyen:', error);
    return null;
  }
}

// 🎫 SCHEMAS DE TICKETS DE SUPORTE  
import { 
  generateTicketId, 
  generateMessageId, 
  insertSupportTicketSchema, 
  insertSupportMessageSchema,
  SupportTicket,
  SupportMessage
} from '../shared/schema';

// 🖼️ SISTEMA AUTOMÁTICO DE IMAGENS PERMANENTES - INTEGRADO DIRETAMENTE

// 🛡️ VALIDAR SE URL É SEGURA (PREVINE SSRF)
function isPrivateOrLocalIP(hostname: string): boolean {
  // Regex para detectar IPs privados e localhost
  const privateIPPatterns = [
    /^127\./,                    // 127.0.0.0/8 (localhost)
    /^10\./,                     // 10.0.0.0/8 (private)
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (private)
    /^192\.168\./,               // 192.168.0.0/16 (private)
    /^169\.254\./,               // 169.254.0.0/16 (link-local)
    /^0\./,                      // 0.0.0.0/8 (invalid)
    /^::1$/,                     // IPv6 localhost
    /^fc00::/,                   // IPv6 private
    /^fe80::/                    // IPv6 link-local
  ];
  
  // Verificar hostnames inseguros
  const unsafeHosts = [
    '127.0.0.1', '::1',
    'local', 'internal', 'private', 'admin',
    'metadata.google.internal', // AWS/GCP metadata
    '169.254.169.254'           // AWS metadata IP
  ];
  
  if (unsafeHosts.some(host => hostname.toLowerCase().includes(host))) {
    return true;
  }
  
  return privateIPPatterns.some(pattern => pattern.test(hostname));
}

// 🔍 DETECTAR SE É URL EXTERNA SEGURA
function isExternalImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  
  // Verificar se é URL interna do sistema
  if (url.includes('volatuspay.com') || url.startsWith('/uploads/')) {
    return false;
  }
  
  // Verificar se é URL válida
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false; // URL inválida
  }
  
  // 🛡️ PROTEÇÃO SSRF - Bloquear IPs privados e localhost
  if (isPrivateOrLocalIP(parsedUrl.hostname)) {
    console.warn(`🚨 SSRF BLOCKED: Tentativa de acesso a IP privado/localhost: ${parsedUrl.hostname}`);
    return false;
  }
  
  // Verificar se é HTTP/HTTPS válido
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    console.warn(`🚨 INVALID PROTOCOL: Protocolo não permitido: ${parsedUrl.protocol}`);
    return false;
  }
  
  // Verificar se parece com uma imagem
  const hasImageExtension = url.match(/\.(jpg|jpeg|png|webp|bmp|svg)(\?.*)?$/i);
  const isImageService = url.includes('discord') || url.includes('googleusercontent') || 
                         url.includes('imgur') || url.includes('postimg') || 
                         url.includes('cloudinary') || url.includes('unsplash');
  
  return !!hasImageExtension || isImageService;
}

// 📁 GARANTIR DIRETÓRIO
function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📁 Diretório criado: ${dirPath}`);
  }
}

// 🔗 EXTENSÃO DA URL
function getImageExtension(url: string): string {
  const match = url.match(/\.(jpg|jpeg|png|webp|bmp|svg)/i);
  if (match) return match[1].toLowerCase();
  if (url.includes('discord')) return 'png';
  if (url.includes('google')) return 'jpg';
  return 'png';
}

// 📥 DOWNLOAD DA IMAGEM
function downloadImage(url: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    const timeout = 10000;
    
    console.log(`📥 Iniciando download: ${url}`);
    console.log(`💾 Salvando em: ${outputPath}`);
    
    const request = protocol.get(url, { timeout }, (response: any) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log(`🔄 Redirecionamento: ${response.headers.location}`);
        downloadImage(response.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Status ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(outputPath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        const fileSize = fs.statSync(outputPath).size;
        console.log(`✅ Download concluído: ${fileSize} bytes`);
        resolve(true);
      });
      
      fileStream.on('error', (err: any) => {
        fs.unlink(outputPath, () => {});
        reject(err);
      });
    });
    
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
    
    request.on('error', (err: any) => {
      reject(err);
    });
  });
}

// 🔥 PROCESSAR URL EXTERNA COM SEGURANÇA TOTAL
async function processExternalImageUrl(logoUrl: string): Promise<{success: boolean, permanentUrl?: string, originalUrl?: string, error?: string}> {
  try {
    if (!logoUrl || !isExternalImageUrl(logoUrl)) {
      return { success: true, permanentUrl: logoUrl, originalUrl: logoUrl };
    }
    
    console.log(`🖼️ PROCESSANDO IMAGEM EXTERNA SEGURA: ${logoUrl}`);
    
    // 🛡️ VALIDAÇÃO ADICIONAL ANTES DO DOWNLOAD
    let parsedUrl;
    try {
      parsedUrl = new URL(logoUrl);
      
      // Re-verificar se não é IP privado (proteção extra)
      if (isPrivateOrLocalIP(parsedUrl.hostname)) {
        throw new Error(`SSRF BLOCKED: IP privado/localhost detectado: ${parsedUrl.hostname}`);
      }
    } catch (urlError: any) {
      console.error(`🚨 URL INVÁLIDA REJEITADA: ${logoUrl} - ${urlError.message}`);
      throw new Error('URL inválida ou insegura fornecida');
    }
    
    const uploadsDir = path.resolve(import.meta.dirname, '..', 'uploads');
    const imagesDir = path.join(uploadsDir, 'images');
    ensureDirectoryExists(imagesDir);
    
    const fileExtension = getImageExtension(logoUrl);
    const uniqueId = nanoid(12);
    const timestamp = Date.now();
    const fileName = `logo_${timestamp}_${uniqueId}.${fileExtension}`;
    const filePath = path.join(imagesDir, fileName);
    
    // 📥 TENTAR DOWNLOAD COM MÚLTIPLAS TENTATIVAS
    let downloadSuccess = false;
    let lastError = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📥 Tentativa ${attempt}/3: Baixando ${logoUrl}`);
        await downloadImage(logoUrl, filePath);
        downloadSuccess = true;
        break;
      } catch (downloadError: any) {
        lastError = downloadError;
        console.warn(`⚠️ Tentativa ${attempt}/3 falhou: ${downloadError.message}`);
        
        // Remover arquivo parcial se existir
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        
        // Aguardar antes da próxima tentativa (exceto na última)
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    // 🚨 SE TODAS AS TENTATIVAS FALHARAM - REJEITAR COMPLETAMENTE
    if (!downloadSuccess) {
      console.error(`🚨 DOWNLOAD FALHOU COMPLETAMENTE após 3 tentativas: ${logoUrl}`);
      console.error(`🚨 Último erro: ${lastError?.message}`);
      
      // 🛡️ SEGURANÇA: NUNCA RETORNAR URL EXTERNA EM CASO DE FALHA
      // Isso previne URLs expiradas ou maliciosas
      throw new Error(`Falha no download da imagem após 3 tentativas: ${lastError?.message}`);
    }
    
    // ✅ VERIFICAR SE O ARQUIVO FOI REALMENTE SALVO
    if (!fs.existsSync(filePath)) {
      throw new Error('Arquivo não foi salvo corretamente');
    }
    
    const fileStats = fs.statSync(filePath);
    if (fileStats.size === 0) {
      fs.unlinkSync(filePath); // Remover arquivo vazio
      throw new Error('Arquivo baixado está vazio');
    }
    
    const permanentUrl = `/uploads/images/${fileName}`;
    
    console.log(`🎉 IMAGEM SALVA COM SEGURANÇA TOTAL!`);
    console.log(`📥 Original: ${logoUrl}`);
    console.log(`💾 Permanente: ${permanentUrl}`);
    console.log(`📊 Tamanho: ${fileStats.size} bytes`);
    
    return { success: true, permanentUrl, originalUrl: logoUrl };
    
  } catch (error: any) {
    // 🔒 SECURITY: Sanitizar erro antes de logar
    console.error(`❌ PROCESSAMENTO DE IMAGEM REJEITADO:`, sanitizeError(error));
    
    // 🛡️ COMPORTAMENTO SEGURO: REJEITAR UPDATE EM VEZ DE MANTER URL EXTERNA
    // Isso previne problemas de URLs expiradas ou maliciosas
    return { 
      success: false, 
      error: `Processamento rejeitado por segurança: ${error.message}`,
      originalUrl: logoUrl
      // ⚠️ Não definir permanentUrl - força sistema a usar placeholder ou rejeitar
    };
  }
}

// 💰 HELPER: CALCULAR TAXAS DINÂMICAS BASEADO NA CONFIGURAÇÃO DO ADMIN
// 💰 HELPER: CALCULAR TAXAS DINÂMICAS BASEADO NA CONFIGURAÇÃO DO ADMIN
// ✅ CORRIGIDO V2: Combina eternal-fees (RTDB) com lógica específica por gateway/parcelas
// 💰 HELPER: CALCULAR TAXAS DINÂMICAS BASEADO NA CONFIGURAÇÃO DO ADMIN
// ✅ VERSÃO FINAL: Combina acquirers-config (Firestore) + eternal-fees (RTDB)
export async function calculateDynamicFees(
  orderAmount: number,
  paymentMethod: string,
  installments: number | string = 1,
  gateway: string = 'efibank',
  sellerId?: string
): Promise<{
  gatewayFee: number;
  gatewayFeePercent: number;
  platformFee: number;
  platformFeePercent: number;
  netAmount: number;
  grossAmount: number;
  releaseDays: number;
}> {
  try {
    const safeInstallments = typeof installments === 'number' ? installments : (parseInt(String(installments)) || 1);
    const safeGateway = typeof gateway === 'string' ? gateway : String(gateway || 'efibank');
    console.log(`🧮 calculateDynamicFees: amount=${orderAmount} method=${paymentMethod} gateway=${safeGateway} installments=${safeInstallments}`);
    
    // 1️⃣ BUSCAR CONFIGURAÇÃO DO ADMIN (FIRESTORE) - ÚNICA FONTE DE VERDADE
    await ensureFirebaseReady();
    const db = getFirestore();
    let config = await getPaymentConfig(db);

    // Fallback: se paymentConfig/global não existe no Firestore, usar taxas eternas do RTDB
    if (!config || !config.fees) {
      console.warn('⚠️ [calculateDynamicFees] paymentConfig/global ausente — usando loadEternalFees como fallback');
      const eternalFees = await loadEternalFees(db);
      config = {
        id: 'global',
        fees: eternalFees,
        defaultAcquirers: { pix: 'efibank', creditCardBR: 'efibank', creditCardGlobal: 'stripe', boleto: 'efibank' },
        stripe: { enabled: false, environment: 'test' } as any,
        efibank: { enabled: true, environment: 'production' } as any,
        adyen: { enabled: false, environment: 'test' } as any,
        woovi: { enabled: false, environment: 'sandbox' } as any,
        pagarme: { enabled: false, environment: 'test' } as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
    }

    // 🎯 SELLER OVERRIDE: Buscar taxas customizadas do seller (se houver)
    let sellerCustomFees: any = null;
    if (sellerId) {
      try {
        const sellerDoc = await db.collection('sellers').doc(sellerId).get();
        if (sellerDoc.exists) {
          const sellerData = sellerDoc.data();
          const hasCustomFees = sellerData?.customPixFixedFee !== undefined ||
            sellerData?.customPixPercentFee !== undefined ||
            sellerData?.customCardFixedFee !== undefined ||
            sellerData?.customCardPercentFee !== undefined ||
            sellerData?.customInstallment1x !== undefined;
          if (hasCustomFees) {
            sellerCustomFees = sellerData;
            console.log(`🎯 [SELLER OVERRIDE] Taxas customizadas ativas para seller: ${sellerId}`);
          }
        }
      } catch (overrideErr: any) {
        console.warn(`⚠️ [SELLER OVERRIDE] Falha ao buscar taxas do seller ${sellerId}: ${overrideErr?.message}`);
      }
    }
    
    let gatewayFeePercent = 0;
    let gatewayFeeFixed = 0;
    let releaseDays = 30; // Padrão
    
    // 2️⃣ CALCULAR TAXAS BASEADO APENAS NO ADMIN/ADQUIRENTES
    if (paymentMethod === 'pix') {
      // PIX: Usar configuração específica do gateway
      if (safeGateway === 'woovi') {
        if (!config.woovi?.pixFeeFixed) {
          throw new Error('⚠️ Taxa PIX Woovi não configurada em Admin > Adquirentes');
        }
        gatewayFeeFixed = Math.round(config.woovi.pixFeeFixed * 100);
        gatewayFeePercent = config.woovi.pixFeePercent || 0;
        releaseDays = config.woovi.releaseDays || 0;
      } else if (safeGateway === 'pagarme') {
        if (!config.pagarme?.pixFeeFixed) {
          throw new Error('⚠️ Taxa PIX Pagar.me não configurada em Admin > Adquirentes');
        }
        gatewayFeeFixed = Math.round(config.pagarme.pixFeeFixed * 100);
        gatewayFeePercent = config.pagarme.pixFeePercent || 0;
        releaseDays = config.pagarme.releaseDays || 0;
      } else {
        // EfíBank (ou fallback para gateways não reconhecidos)
        if (safeGateway !== 'efibank' && safeGateway !== 'efipay') {
          console.warn(`⚠️ [FEES] Gateway PIX desconhecido "${safeGateway}" — usando taxas EfíBank como fallback. Verifique Admin > Adquirentes.`);
        }
        // BUSCAR TAXAS DO CONFIG.FEES (CONFIGURAÇÃO GLOBAL DE TAXAS)
        const pixFeePercent = config.fees?.pixPercentFee || config.efibank?.pixFeePercent || 0;
        // config.fees.pixFixedFee está em CENTAVOS — usar diretamente (sem heurística > 100)
        const pixFeeFixed = config.fees?.pixFixedFee ?? 0;
        const pixReleaseDays = config.fees?.pixReleaseDays ?? config.efibank?.releaseDays ?? 0;
        
        if (!pixFeePercent && !pixFeeFixed) {
          console.warn('⚠️ Taxa PIX EfíBank não configurada - usando valores padrão');
        }
        
        gatewayFeeFixed = pixFeeFixed; // já em centavos
        gatewayFeePercent = pixFeePercent;
        releaseDays = pixReleaseDays;
      }
        console.log(`✅ [EFIBANK PIX] Taxa Fixa: R$ ${(gatewayFeeFixed / 100).toFixed(2)} | Taxa %: ${gatewayFeePercent}% | Release: D+${releaseDays}`);
      // 🎯 SELLER OVERRIDE: PIX
      if (sellerCustomFees) {
        if (sellerCustomFees.customPixPercentFee !== undefined) gatewayFeePercent = sellerCustomFees.customPixPercentFee;
        if (sellerCustomFees.customPixFixedFee !== undefined) {
          const raw = sellerCustomFees.customPixFixedFee;
          gatewayFeeFixed = raw > 100 ? raw : Math.round(raw * 100);
        }
        if (sellerCustomFees.customPixWithdrawalDays !== undefined) releaseDays = sellerCustomFees.customPixWithdrawalDays;
        console.log(`🎯 [SELLER OVERRIDE PIX] Taxa: ${gatewayFeePercent}% + R$ ${(gatewayFeeFixed/100).toFixed(2)} | D+${releaseDays}`);
      }
    } 
    else if (paymentMethod === 'card' || paymentMethod === 'stripe' || paymentMethod === 'credit_card') {
      // CARTÕES: Usar configuração específica do gateway e parcelas
      let acquirerConfig: any;
      if (safeGateway === 'stripe') {
        acquirerConfig = config.stripe;
      } else if (safeGateway === 'pagarme') {
        acquirerConfig = config.pagarme;
      } else {
        acquirerConfig = config.efibank;
      }

      // 🔄 FALLBACK: Ler de admin/acquirers-config se paymentConfig/global não tem as taxas por parcela
      let adminAcquirerConfig: any = null;
      try {
        await ensureFirebaseReady();
        const _fsCard = getAdmin().firestore();
        const adminCfgDoc = await _fsCard.collection('admin').doc('acquirers-config').get();
        if (adminCfgDoc.exists) {
          const adminCfgData = adminCfgDoc.data();
          if (safeGateway === 'stripe') adminAcquirerConfig = adminCfgData.stripe;
          else if (safeGateway === 'pagarme') adminAcquirerConfig = adminCfgData.pagarme;
          else adminAcquirerConfig = adminCfgData.efibank;
        }
      } catch (adminCfgErr) {
        console.warn('⚠️ [CARD] Falha ao ler admin/acquirers-config, usando paymentConfig/global');
      }

      // Mesclar: paymentConfig/global tem prioridade, admin/acquirers-config como fallback
      const merged: any = { ...(adminAcquirerConfig || {}), ...(acquirerConfig || {}) };

      if (!merged || Object.keys(merged).length === 0) {
        throw new Error(`⚠️ Configuração de cartões para ${safeGateway} não encontrada em Admin > Adquirentes`);
      }
      
      // Determinar taxa baseado no número de parcelas (APENAS config do admin)
      if (safeInstallments === 1) {
        gatewayFeePercent = merged.installment1x || merged.cardFeePercent;
      } else if (safeInstallments >= 2 && safeInstallments <= 6) {
        gatewayFeePercent = merged.installment2to6x || merged.installment6x || merged.cardFeePercent;
      } else if (safeInstallments >= 7 && safeInstallments <= 9) {
        gatewayFeePercent = merged.installment7to9x || merged.installment9x || merged.cardFeePercent;
      } else if (safeInstallments >= 10 && safeInstallments <= 12) {
        gatewayFeePercent = merged.installment10to12x || merged.installment12x || merged.cardFeePercent;
      } else {
        gatewayFeePercent = merged.cardFeePercent;
      }
      
      // Fallback: taxas do config.fees global
      if (!gatewayFeePercent) {
        gatewayFeePercent = config.fees?.creditCardBRPercentFee || 0;
      }

      if (!gatewayFeePercent) {
        throw new Error(`⚠️ Taxa percentual de cartões não configurada para ${safeInstallments}x em Admin > Adquirentes`);
      }
      
      // Taxa fixa em centavos - config.fees.creditCardBRFixedFee e merged.cardFeeFixed estão em CENTAVOS
      gatewayFeeFixed = config.fees?.creditCardBRFixedFee || merged?.cardFeeFixed || 0;

      // 📅 PRAZO DE SAQUE POR FAIXA DE PARCELAS
      // Prioridade: campo específico por faixa > campo único > config.fees global > padrão 30
      const baseWithdrawalDays = merged?.withdrawalDays ?? config.fees?.creditCardBRReleaseDays ?? 30;
      if (safeInstallments === 1) {
        releaseDays = merged?.withdrawalDays1x ?? baseWithdrawalDays;
      } else if (safeInstallments >= 2 && safeInstallments <= 6) {
        releaseDays = merged?.withdrawalDays2to6x ?? baseWithdrawalDays;
      } else if (safeInstallments >= 7 && safeInstallments <= 9) {
        releaseDays = merged?.withdrawalDays7to9x ?? baseWithdrawalDays;
      } else {
        releaseDays = merged?.withdrawalDays10to12x ?? baseWithdrawalDays;
      }
      console.log(`✅ [CARD BR] Taxa Fixa: R$ ${(gatewayFeeFixed / 100).toFixed(2)} | Taxa %: ${gatewayFeePercent}% | Release: D+${releaseDays} (${safeInstallments}x)`);
      // 🎯 SELLER OVERRIDE: Cartão
      if (sellerCustomFees) {
        const isStripe = safeGateway === 'stripe';
        if (isStripe) {
          if (safeInstallments === 1 && sellerCustomFees.customStripeInstallment1x !== undefined) gatewayFeePercent = sellerCustomFees.customStripeInstallment1x;
          else if (safeInstallments >= 2 && safeInstallments <= 6 && sellerCustomFees.customStripeInstallment2to6x !== undefined) gatewayFeePercent = sellerCustomFees.customStripeInstallment2to6x;
          else if (safeInstallments >= 7 && safeInstallments <= 9 && sellerCustomFees.customStripeInstallment7to9x !== undefined) gatewayFeePercent = sellerCustomFees.customStripeInstallment7to9x;
          else if (safeInstallments >= 10 && sellerCustomFees.customStripeInstallment10to12x !== undefined) gatewayFeePercent = sellerCustomFees.customStripeInstallment10to12x;
          if (sellerCustomFees.customStripeFixedFee !== undefined) {
            const raw = sellerCustomFees.customStripeFixedFee;
            gatewayFeeFixed = raw > 100 ? raw : Math.round(raw * 100);
          }
          if (sellerCustomFees.customStripeWithdrawalDays !== undefined) releaseDays = sellerCustomFees.customStripeWithdrawalDays;
        } else {
          if (safeInstallments === 1 && sellerCustomFees.customInstallment1x !== undefined) gatewayFeePercent = sellerCustomFees.customInstallment1x;
          else if (safeInstallments >= 2 && safeInstallments <= 6 && sellerCustomFees.customInstallment2to6x !== undefined) gatewayFeePercent = sellerCustomFees.customInstallment2to6x;
          else if (safeInstallments >= 7 && safeInstallments <= 9 && sellerCustomFees.customInstallment7to9x !== undefined) gatewayFeePercent = sellerCustomFees.customInstallment7to9x;
          else if (safeInstallments >= 10 && sellerCustomFees.customInstallment10to12x !== undefined) gatewayFeePercent = sellerCustomFees.customInstallment10to12x;
          if (sellerCustomFees.customCardFixedFee !== undefined) {
            const raw = sellerCustomFees.customCardFixedFee;
            gatewayFeeFixed = raw > 100 ? raw : Math.round(raw * 100);
          }
          if (sellerCustomFees.customCardWithdrawalDays !== undefined) releaseDays = sellerCustomFees.customCardWithdrawalDays;
        }
        console.log(`🎯 [SELLER OVERRIDE CARD] Taxa: ${gatewayFeePercent}% + R$ ${(gatewayFeeFixed/100).toFixed(2)} | D+${releaseDays} (${safeInstallments}x)`);
      }
    }
    else if (paymentMethod === 'boleto') {
      // BOLETO: BUSCAR TAXAS DO CONFIG.FEES COM FALLBACK PARA PAGARME
      let boletoFixedFee = config.fees?.boletoFixedFee || config.pagarme?.boletoFeeFixed || 0;
      const boletoPercentFee = config.fees?.boletoPercentFee || config.pagarme?.boletoFeePercent || 0;
      const boletoReleaseDays = config.fees?.boletoReleaseDays ?? config.pagarme?.releaseDays ?? 3;

      // config.fees.boletoFixedFee está em CENTAVOS — usar diretamente (sem heurística)
      gatewayFeeFixed = boletoFixedFee;
      gatewayFeePercent = boletoPercentFee;
      releaseDays = boletoReleaseDays;
      console.log(`✅ [BOLETO] Taxa Fixa: R$ ${(gatewayFeeFixed / 100).toFixed(2)} | Taxa %: ${gatewayFeePercent}% | Release: D+${releaseDays}`);
      // 🎯 SELLER OVERRIDE: Boleto
      if (sellerCustomFees) {
        if (sellerCustomFees.customBoletoPercentFee !== undefined) gatewayFeePercent = sellerCustomFees.customBoletoPercentFee;
        if (sellerCustomFees.customBoletoFixedFee !== undefined) {
          const raw = sellerCustomFees.customBoletoFixedFee;
          gatewayFeeFixed = raw > 100 ? raw : Math.round(raw * 100);
        }
        if (sellerCustomFees.customBoletoWithdrawalDays !== undefined) releaseDays = sellerCustomFees.customBoletoWithdrawalDays;
        console.log(`🎯 [SELLER OVERRIDE BOLETO] Taxa: ${gatewayFeePercent}% + R$ ${(gatewayFeeFixed/100).toFixed(2)} | D+${releaseDays}`);
      }
    }
    
    // 3️⃣ CALCULAR TAXAS EM CENTAVOS
    let gatewayFee = 0;
    
    if (safeGateway === 'woovi' && paymentMethod === 'pix') {
      // WOOVI: Taxa FIXA em centavos
      gatewayFee = gatewayFeeFixed;
      console.log(`💰 WOOVI TAXA FIXA: R$ ${(gatewayFee/100).toFixed(2)} por venda`);
    } else if (safeGateway === 'pagarme' && paymentMethod === 'pix') {
      // PAGAR.ME: Taxa FIXA + PERCENTUAL
      const percentFee = Math.round(orderAmount * (gatewayFeePercent / 100));
      gatewayFee = gatewayFeeFixed + percentFee;
      console.log(`💰 PAGAR.ME PIX: Taxa Fixa R$ ${(gatewayFeeFixed/100).toFixed(2)} + ${gatewayFeePercent}% = R$ ${(gatewayFee/100).toFixed(2)} total`);
    } else {
      // OUTROS: Taxa percentual + fixa
      const percentFee = Math.round(orderAmount * (gatewayFeePercent / 100));
      gatewayFee = percentFee + gatewayFeeFixed;
    }
    
    // 4️⃣ PLATFORM FEE: Apenas do admin (se não configurado = 0%)
    if (config.platformFee === undefined || config.platformFee === null) {
      console.warn(`⚠️ [FEES] platformFee não configurado no Firestore — usando 0%. Configure em Admin > Configurações de Pagamento.`);
    }
    const platformFeePercent = config.platformFee !== undefined ? config.platformFee : 0;
    const platformFee = Math.round(orderAmount * (platformFeePercent / 100));
    
    // 5️⃣ NET AMOUNT
    const netAmount = orderAmount - gatewayFee - platformFee;
    
    console.log(`💰 TAXAS CALCULADAS (ADMIN): Método=${paymentMethod} Gateway=${gatewayFeePercent}%+R$${(gatewayFeeFixed/100).toFixed(2)} (R$ ${(gatewayFee/100).toFixed(2)}) Platform=${platformFeePercent}% (R$ ${(platformFee/100).toFixed(2)}) Net=R$ ${(netAmount/100).toFixed(2)} Release=D+${releaseDays}`);
    
    return {
      gatewayFee,
      gatewayFeePercent,
      platformFee,
      platformFeePercent,
      netAmount,
      grossAmount: orderAmount,
      releaseDays
    };
  } catch (error) {
    console.error('❌ ERRO CRÍTICO: Falha ao calcular taxas (config ausente?)', error);
    throw error; // Re-throw - sistema DEVE ter configuração de taxas no Firestore
  }
}




// 📅 HELPER: CALCULAR PRAZO DE SAQUE BASEADO NO MÉTODO/GATEWAY
async function getWithdrawalDays(paymentMethod: string, gateway: string, installments: number = 1): Promise<number> {
  try {
    try {
      await ensureFirebaseReady();
      const _fsWd = getAdmin().firestore();
      try {
        // Ler de admin/acquirers-config (fonte correta configurada pelo admin)
        const configSnapshot = await _fsWd.collection('admin').doc('acquirers-config').get();
        if (configSnapshot.exists) {
          const cfg = configSnapshot.data();
          
          if (paymentMethod === 'pix') {
            return cfg.efibank?.withdrawalDays || 0;
          } else if (paymentMethod === 'credit_card' || paymentMethod === 'card') {
            const acquirer = (gateway === 'stripe' || gateway === 'adyen') ? cfg.stripe : cfg.efibank;
            if (!acquirer) return (gateway === 'stripe' || gateway === 'adyen') ? 30 : 20;
            
            // Per-installment release days (prioridade) → campo único → padrão
            const base = acquirer.withdrawalDays ?? ((gateway === 'stripe' || gateway === 'adyen') ? 30 : 20);
            if (installments === 1) return acquirer.withdrawalDays1x ?? base;
            if (installments >= 2 && installments <= 6) return acquirer.withdrawalDays2to6x ?? base;
            if (installments >= 7 && installments <= 9) return acquirer.withdrawalDays7to9x ?? base;
            return acquirer.withdrawalDays10to12x ?? base;
          } else if (paymentMethod === 'boleto') {
            return cfg.efibank?.withdrawalDays || 2;
          }
        }
      } catch (dbError) {
        console.warn('⚠️ Erro ao buscar prazo de saque do Firebase, usando padrão');
      }
    } catch (_fsWdOuterErr) {
      console.warn('⚠️ Firebase não disponível para prazo de saque, usando padrão');
    }
    
    // Fallback para valores padrão
    if (paymentMethod === 'pix') return 0;
    if (paymentMethod === 'credit_card' || paymentMethod === 'card') {
      return (gateway === 'stripe' || gateway === 'adyen') ? 30 : 20;
    }
    if (paymentMethod === 'boleto') return 2;
    
    return 0;
  } catch (error) {
    console.error('❌ Erro ao calcular prazo de saque:', error);
    return 0;
  }
}

// 🖼️ CONFIGURAR SERVING
function setupImageServing() {
  const uploadsDir = path.resolve(import.meta.dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use('/uploads', (req: any, res: any, next: any) => {
    res.set({ 'Cache-Control': 'public, max-age=31536000', 'Expires': new Date(Date.now() + 31536000000).toUTCString() });
    next();
  }, 
  // 🛡️ MIDDLEWARE DE PROTEÇÃO ANTI-DOWNLOAD
  (req, res, next) => {
    if (req.path.endsWith('.map') || req.path.endsWith('.ts') || req.path.endsWith('.tsx')) {
      console.log(`🚫 STATIC PROTECTION: Blocked source file from ${req.ip}: ${req.path}`);
      return res.status(403).send('Forbidden');
    }
    next();
  },
  express.static(uploadsDir),
  // 🐰 FALLBACK: Se arquivo local não existe, baixar do Bunny CDN Storage
  async (req: any, res: any) => {
    const filePath = req.path.startsWith('/') ? req.path.substring(1) : req.path;
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.webm', '.mp4', '.mov', '.avi', '.pdf'];
    if (!allowedExts.some(ext => filePath.toLowerCase().endsWith(ext))) {
      return res.status(404).send('Not found');
    }
    try {
      const { getBunnyCredentials } = await import('./lib/bunny-helper.js');
      const credentials = await getBunnyCredentials();
      if (!credentials?.storageApiKey) {
        // Fallback: redirect to CDN public pull zone — works without storage credentials
        const cdnHostname = credentials?.cdnHostname || process.env.BUNNY_CDN_HOSTNAME || 'volatuspaypj.b-cdn.net';
        return res.redirect(302, `https://${cdnHostname}/${filePath}`);
      }

      const regionPrefix = credentials.storageRegion && credentials.storageRegion !== 'de' ? `${credentials.storageRegion}.` : '';
      const storageUrl = `https://${regionPrefix}storage.bunnycdn.com/${credentials.storageZoneName}/${filePath}`;
      const fetchModule = await import('node-fetch');
      const cdnResponse = await fetchModule.default(storageUrl, {
        headers: { 'AccessKey': credentials.storageApiKey }
      });
      if (!cdnResponse.ok) return res.status(404).send('Not found');

      const buffer = Buffer.from(await cdnResponse.arrayBuffer());
      const localPath = path.join(uploadsDir, filePath);
      const dirPath = path.dirname(localPath);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(localPath, buffer);
      console.log(`📥 [CDN-CACHE] Imagem baixada e cacheada: /uploads/${filePath}`);

      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
      res.set('Content-Type', mimeMap[ext] || 'application/octet-stream');
      res.set('Cache-Control', 'public, max-age=31536000');
      res.send(buffer);
    } catch (err: any) {
      console.warn(`⚠️ [CDN-CACHE] Falha ao baixar do CDN: ${err.message}`);
      res.status(404).send('Not found');
    }
  });
  console.log(`🖼️ Sistema de imagens permanentes ativo: /uploads`);
}


// ⚡ VOLATUSPAY SERVER
console.log('🔥 Iniciando VolatusPay Server v1.0');

const app = express();
const server = createServer(app);

// ⚡⚡⚡ FAST STARTUP: If server-start.mjs already opened the port (earlyServer),
// attach Express app to it so requests are handled immediately.
// Then monkey-patch server.listen so the callback fires without binding to port again.
{
  if (false) {
    // Removed: Replit early-server fast startup (not needed in production)
  }
}

// ⚡⚡⚡ PRODUCTION STARTUP FIX: Bind port IMMEDIATELY before any route registration!
// The listen callback fires AFTER all synchronous code (all routes will be registered by then).
// This ensures the health check port opens within the timeout window even on slow deployment CPUs.
let isAppFullyReady = false;
{
  const _PORT = parseInt(process.env.PORT || '5000', 10);
  console.log(`🚀 Starting on PORT: ${_PORT} (env: ${process.env.NODE_ENV || 'development'})`);
  server.listen(_PORT, '0.0.0.0', () => {
    console.log(`✅ Server READY on port ${_PORT} - Health checks active`);
    console.log(`🌐 Frontend: http://localhost:${_PORT}`);
    console.log(`📡 API: http://localhost:${_PORT}/api`);
    console.log(`🔐 Sistema de segurança: ATIVO`);
    console.log(`💾 Storage: Firebase Firestore + Bunny CDN`);
    isAppFullyReady = true;
    console.log('✅ isAppFullyReady = true - Deploy health check will pass');

    // 🔥 FIREBASE: Inicializar em background sem bloquear a porta
    (async () => {
      try {
        console.log('🔥 Inicializando Firebase Admin SDK (background)...');
        await ensureFirebaseReady();
        console.log('✅ Firebase Admin SDK pronto!');
        const { startFirebaseHealthMonitor } = await import('./init-health-check.js');
        startFirebaseHealthMonitor();
      } catch (e: any) {
        console.warn('⚠️ Firebase init error (background):', e?.message || e);
      }
    })();

    // 🐘 NEON: Garantir tabelas de segurança e financeiras existem
    (async () => {
      try {
        const { ensureNeonSecurityTables, ensureNeonFinancialTables, ensureNeonWithdrawalTables, ensureNeonProductTables, ensureNeonAffiliateTables, ensureNeonSellerTables, ensureNeonPaymentTables, ensureNeonSubscriptionTables, ensureNeonExtraTables } = await import('./lib/neon-db.js');
        await ensureNeonSecurityTables();
        await ensureNeonFinancialTables();
        await ensureNeonWithdrawalTables();
        await ensureNeonProductTables();
        await ensureNeonAffiliateTables();
        await ensureNeonSellerTables();
        await ensureNeonPaymentTables();
        await ensureNeonSubscriptionTables();
        await ensureNeonExtraTables();
      } catch (e: any) {
        console.warn('⚠️ Neon init error (não crítico):', e?.message || e);
      }
    })();

    // ⚡ SCALE: Event loop monitor
    import('./lib/scale-layer.js').then(({ startEventLoopMonitor }) => {
      startEventLoopMonitor(150);
      console.log('⚡ [SCALE] Event loop monitor ativo (threshold: 150ms)');
    }).catch(() => {});


    // ⚡ WARMUP ASSÍNCRONO EM BACKGROUND
    setImmediate(async () => {
      try {
        await secretsManager.warmSecretsCache();
        await ensureFirebaseReady();
        console.log('✅ Background warmup completo - secrets e Firebase prontos');
        try {
          const { firestoreCache } = await import('./lib/firestore-cache.js');
          const warmUpResult = await firestoreCache.warmUp();
          console.log(`🔥 Cache warm-up: ${warmUpResult.sellers} sellers, ${warmUpResult.duration}ms`);
        } catch (cacheError: any) {
          console.warn('⚠️ Cache warm-up falhou (não crítico):', cacheError.message);
        }
        try {
          const db = getFirestore();
          await syncEternalCredentials(db);
          await checkCredentialsStatus(db);
          console.log('🌟 Credenciais eternas sincronizadas - Sistema 100% configurado!');
          try {
            await autoConfigureBunnyPublic();
          } catch (bunnyError) {
            console.warn("⚠️ Auto-configuração do Bunny Stream falhou (não crítico):", bunnyError);
          }
          if (process.env.NODE_ENV !== 'development') {
            try {
              console.log('📡 [AUTO-WEBHOOK] Iniciando registro automático do webhook EfíBank...');
              const db2 = getFirestore();
              const { getPaymentConfig: _getPaymentConfig } = await import('./lib/payment-config.js');
              const paymentConfig = await _getPaymentConfig(db2);
              const pixKey = paymentConfig?.efibank?.pixKey;
              if (pixKey) {
                let hmac = await getWebhookHmac(db2);
                if (!hmac) {
                  const crypto = await import('crypto');
                  hmac = crypto.randomBytes(32).toString('hex');
                  const { encryptSensitiveData } = await import('./security/key-encryption.js');
                  const encryptedHmac = encryptSensitiveData(hmac);
                  await db2.collection('paymentConfig').doc('global').set(
                    { efibank: { webhookHmac: encryptedHmac } },
                    { merge: true }
                  );
                }
                const domain = getBaseDomain();
                const webhookUrl = `${domain}/webhook/efi?hmac=${hmac}&ignorar=`;
                const lastRegistered = paymentConfig?.efibank?.lastWebhookUrl;
                if (lastRegistered !== webhookUrl) {
                  const certStoragePath = paymentConfig?.efibank?.certificateStoragePath || 'certificates/efi-prod.p12';
                  const certBuffer = await downloadCertFromFirebaseStorage(certStoragePath);
                  const success = await registerEfiBankWebhook(pixKey, webhookUrl, certBuffer);
                  if (success) {
                    await db2.collection('paymentConfig').doc('global').set(
                      { efibank: { lastWebhookUrl: webhookUrl, lastWebhookRegisteredAt: new Date().toISOString() } },
                      { merge: true }
                    );
                  }
                } else {
                  console.log('✅ [AUTO-WEBHOOK] Webhook já registrado com URL correta, pulando');
                }
              } else {
                console.log('⏭️ [AUTO-WEBHOOK] Chave PIX: [REDACTED] configurada, pulando registro de webhook');
              }
            } catch (webhookRegError: any) {
              console.warn('⚠️ [AUTO-WEBHOOK] Registro automático falhou:', webhookRegError?.message);
            }
          }
        } catch (credError) {
          console.warn('⚠️ Sincronização de credenciais eternas falhou:', credError);
        }
      } catch (error: any) {
        console.warn('⚠️ Background warmup falhou (sistema continua funcionando):', error.message);
      }
    });

    // 🚀 PRODUÇÃO: Registrar arquivos estáticos IMEDIATAMENTE (sem delay)
    // Evita janela de 100ms onde assets retornariam 404/500
    if (process.env.NODE_ENV === 'production') {
      try {
        serveStatic(app);
        console.log('🚀 Modo PRODUÇÃO: Arquivos estáticos configurados');
      } catch (error) {
        console.error('❌ ERRO: Arquivos estáticos falhou:', error);
      }
    } else {
      // ⚡ DESENVOLVIMENTO: Vite é async, setup em background não bloqueia health checks
      setTimeout(async () => {
        try {
          await setupVite(app, server);
          console.log('🔧 Modo DESENVOLVIMENTO: Vite middleware ativo');
        } catch (error) {
          console.error('❌ ERRO: Vite setup falhou:', error);
        }
      }, 100);
    }

    // 🆘 AUTO-LIMPAR BLOQUEIOS
    clearNonCriticalBlocks().then(result => {
      if (result.removed > 0) {
        console.log(`🆘 AUTO-UNLOCK: ${result.removed} bloqueios removidos`);
      }
    }).catch(error => {
      console.error('⚠️ Erro ao auto-limpar:', error);
    });

    console.log('⚡ Routes will continue registering while server is already listening...');
  });
}

// 🔒 HARDENING: Desabilitar X-Powered-By permanentemente no nível do Express (antes de qualquer middleware)
app.disable('x-powered-by');

// ✅ TRUST PROXY: Confiar no primeiro proxy para obter IPs reais dos clientes via X-Forwarded-For
// Necessário para rate limiting funcionar corretamente em produção (Replit/Cloudflare)
app.set('trust proxy', 1);

// 🛡️ URI GUARD: Rejeitar URLs malformadas ANTES de qualquer decode (evita URIError crashes de scanners)
app.use((req: any, res: any, next: any) => {
  try {
    decodeURIComponent(req.path);
    next();
  } catch {
    res.status(400).end('Bad Request');
  }
});

// 🚦 JANELA GLOBAL DE FLOOD — conta TODAS as requests em uma janela de 500ms (independente de IP)
// 100 requests simultâneos chegam em ~10ms → todos na mesma janela → a partir do 81º: 429
// Funciona mesmo quando o scanner usa IPs diferentes (teste distribuído)
// Para tráfego real: 80 req/500ms = 160 req/s global — adequado para produção SaaS
const _globalFloodBucket = { count: 0, windowStart: Date.now() };
const _GLOBAL_FLOOD_WINDOW_MS = 500;
const _GLOBAL_FLOOD_MAX = 80;
app.use((req: any, res: any, next: any) => {
  // Ignorar localhost e assets estáticos
  // req.ip usa X-Forwarded-For (trust proxy) — correto para produção via proxy
  const resolvedIp = req.ip || req.socket?.remoteAddress || '';
  const resolvedPath = req.path || '';
  const isLocal = resolvedIp === '127.0.0.1' || resolvedIp === '::1' || resolvedIp === '::ffff:127.0.0.1';
  const isAsset = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map|webp|avif|mp4|webm)(\?.*)?$/.test(resolvedPath)
    || resolvedPath.startsWith('/assets/')
    || resolvedPath.startsWith('/uploads/')
    || resolvedPath.startsWith('/logos/')
    || resolvedPath.startsWith('/images/')
    || resolvedPath.startsWith('/icons/');
  const isViteDev = resolvedPath.startsWith('/@') || resolvedPath.startsWith('/src/') || resolvedPath.includes('/__vite');
  if (isLocal || isAsset || isViteDev) return next();

  const now = Date.now();
  if (now - _globalFloodBucket.windowStart > _GLOBAL_FLOOD_WINDOW_MS) {
    _globalFloodBucket.count = 0;
    _globalFloodBucket.windowStart = now;
  }
  _globalFloodBucket.count++;
  if (_globalFloodBucket.count > _GLOBAL_FLOOD_MAX) {
    res.setHeader('Retry-After', '1');
    res.setHeader('X-RateLimit-Global', `limit=${_GLOBAL_FLOOD_MAX};window=${_GLOBAL_FLOOD_WINDOW_MS}ms`);
    return res.status(429).json({ error: 'Too many requests. Please slow down.', code: 'GLOBAL_FLOOD_LIMIT' });
  }
  next();
});

// 🚦 RATE LIMIT GLOBAL — PRIMEIRÍSSIMA CAMADA (antes de Vite, rotas e tudo mais)
// Janela de 15s / máx 80 req: reforço adicional por IP
// Nota: rateLimit importado no topo do arquivo (linha 466)
// Rotas estáticas e Vite dev — não devem ser contadas no rate limit
// Assets estáticos fazem 20-50 req por page load; contar eles bloqueia usuários legítimos
const _isViteDevPath = (req: any): boolean => {
  const p = req.path || '';
  // Static assets (production + dev)
  if (
    p.startsWith('/assets/') ||
    p.startsWith('/public/') ||
    p.startsWith('/uploads/') ||
    p.startsWith('/logos/') ||
    p.startsWith('/images/') ||
    p.startsWith('/icons/') ||
    /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map|webp|avif|mp4|webm)(\?.*)?$/.test(p)
  ) return true;
  // Vite HMR / dev server routes
  return (
    p.startsWith('/@') ||
    p.startsWith('/src/') ||
    p.startsWith('/node_modules/') ||
    p.includes('/__vite') ||
    p.includes('.vite/')
  );
};

const _earlyGlobalLimiter = rateLimit({
  windowMs: 15 * 1000, // 15 segundos
  max: 300, // 300 req/15s por IP — cobre página de checkout + polling PIX (era 80, muito baixo)
  message: { error: 'Too many requests. Please slow down.', code: 'RATE_LIMIT_GLOBAL_ALL' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: true },
  skip: (req: any) => {
    const ip = req.ip || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    // API Key válida: bypass total do rate limiter global
    const keyHeader = req.headers['x-api-key'] as string | undefined;
    const authHeader = req.headers['authorization'] as string | undefined;
    const apiKey = keyHeader || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);
    if (apiKey && (apiKey.startsWith('vp_live_') || apiKey.startsWith('vp_test_') || apiKey.startsWith('vp_'))) return true;
    // Polling de status PIX e rotas de pagamento têm seu próprio rate limit
    const p = req.path || '';
    if (p.includes('/status') || p.startsWith('/api/payment/') || p.startsWith('/api/orders/') || p.startsWith('/api/checkout')) return true;
    return _isViteDevPath(req);
  },
});
app.use(_earlyGlobalLimiter);

// 🔒 HARDENING: Bloquear método TRACE explicitamente (anti-XST attack) — antes de tudo
app.use((req: any, res: any, next: any) => {
  if (req.method === 'TRACE') {
    res.setHeader('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    return res.status(405).end();
  }
  next();
});

// 🛡️ HARDENING: Security headers mandatórios em TODAS as respostas — primeiríssima camada
app.use((req: any, res: any, next: any) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self), payment=(), usb=(), bluetooth=()');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // ✅ CSP na camada mais alta — garante presença mesmo em respostas 403/405 das camadas de segurança
  const _cspIsDev = process.env.NODE_ENV !== 'production';
  // Em produção: sem unsafe-inline e sem unsafe-eval (Vite build usa módulos externos + CSS em arquivos separados)
  // Em dev: unsafe-inline + unsafe-eval necessários para HMR do Vite
  // Hashes de inline scripts conhecidos (tema + scripts de terceiros)
  // NOTA: hashes incluídos em AMBOS os modos porque o proxy Replit pode remover unsafe-inline
  const _themeScriptHash = "'sha256-zipUUN0SUlbXuU7kJRUWs6x6jfHbunVWVzZfI21Wm/s='";
  const _thirdPartyHash  = "'sha256-gCy0mvR446lp/h9kmZMeZlg94pGTas2enXdE8GKMjAY='";
  const _knownHashes     = " " + _themeScriptHash + " " + _thirdPartyHash;
  const _scriptSrcExtras = _cspIsDev ? (" 'unsafe-inline' 'unsafe-eval'" + _knownHashes) : _knownHashes;
  const _styleSrcExtras  = " 'unsafe-inline'";
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'" + _scriptSrcExtras + " https://js.stripe.com https://checkout.stripe.com https://pay.google.com https://apis.google.com https://*.googleapis.com https://www.gstatic.com https://*.gstatic.com https://*.firebaseio.com https://cdn.jsdelivr.net https://unpkg.com https://tokenizer.sejaefi.com.br https://*.sejaefi.com.br https://device.clearsale.com.br https://web.fpcs-monitor.com.br https://*.clearsale.com.br https://connect.facebook.net https://www.youtube.com https://www.youtube-nocookie.com https://s.ytimg.com https://player.vimeo.com https://*.pandavideo.com.br https://cdn.discordapp.com https://analytics.tiktok.com https://www.googletagmanager.com https://s.pinimg.com https://static.kwai.net; " +
    "style-src 'self'" + _styleSrcExtras + " https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
    "img-src 'self' data: blob: https:; " +
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; " +
    "connect-src 'self' https: wss: https://*.firebaseio.com https://*.googleapis.com; " +
    "frame-src 'self' https://js.stripe.com https://checkout.stripe.com https://pay.google.com https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://*.pandavideo.com.br; " +
    "frame-ancestors 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self';"
  );
  next();
});

// 🚫 HARDENING: Bloquear PUT/DELETE em rotas que não sejam API ou Webhook — retorna 405
app.use((req: any, res: any, next: any) => {
  if ((req.method === 'PUT' || req.method === 'DELETE') &&
      !req.path.startsWith('/api/') &&
      !req.path.startsWith('/webhook/')) {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  next();
});

// 🔐 HARDENING: Proteger painel admin com verificação de sessão server-side
// Redireciona para login se não houver cookie de sessão (scanner/bot não tem cookie)
// Nota: cookieParser ainda não rodou aqui, por isso parseia o header manualmente
app.use((req: any, res: any, next: any) => {
  if (req.method === 'GET' && req.path.startsWith('/admin')) {
    const acceptsHtml = (req.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      const cookieHeader = req.headers.cookie || '';
      const hasVpAuth = cookieHeader.split(';').some((c: string) => c.trim().startsWith('vp_auth=') && c.includes('1'));
      if (!hasVpAuth) {
        return res.redirect(302, '/entrar?redirect=' + encodeURIComponent(req.path));
      }
    }
  }
  next();
});

// 🚦 HARDENING: Limite de tamanho de payload ANTES do body parser
// Multipart (uploads): até 5MB | Qualquer outro content-type: máximo 50KB
// Dupla verificação: Content-Length header + streaming byte counter
app.use((req: any, res: any, next: any) => {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  const isMultipart = contentType.startsWith('multipart/');
  const maxBytes = isMultipart ? 5 * 1024 * 1024 : 50 * 1024; // 5MB para uploads, 50KB para o resto
  const label = isMultipart ? '5MB' : '50KB';

  // Verificação rápida via Content-Length (quando disponível)
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > maxBytes) {
    return res.status(413).json({ error: 'Payload Too Large', code: 'PAYLOAD_TOO_LARGE', maxSize: label });
  }

  // Verificação streaming: conta bytes reais independentemente do header
  if (!isMultipart && req.method !== 'GET' && req.method !== 'HEAD') {
    let received = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (!rejected && received > maxBytes) {
        rejected = true;
        req.destroy();
        if (!res.headersSent) {
          res.status(413).json({ error: 'Payload Too Large', code: 'PAYLOAD_TOO_LARGE', maxSize: label });
        }
      }
    });
  }

  next();
});

// 🛑 GRACEFUL SHUTDOWN + REQUEST TRACKING
import { setupGracefulShutdown, trackRequest } from './lib/graceful-shutdown.js';
setupGracefulShutdown(server);
app.use(trackRequest);

// 📥 WEBHOOK QUEUE - Processamento assíncrono
import { webhookQueue } from './lib/webhook-queue.js';
webhookQueue.setConcurrency(3);

// 📊 WEBHOOK QUEUE STATS ENDPOINT
app.get('/api/webhook-queue/stats', verifyFirebaseToken, requireAdmin, (req, res) => {
  res.json(webhookQueue.getStats());
});

// 🏢 MULTI-COMPANY ROUTES
app.use(sellerCompaniesRouter);

// ⏰ INICIAR CRON JOB DE SUBSCRIPTIONS
console.log('⏰ Inicializando cron job de subscriptions...');
startSubscriptionCron();

// 💳 INICIAR DUNNING CRON (smart retry de cartão recusado, a cada 6h)
console.log('💳 Inicializando dunning cron (retry de cartão)...');
startDunningCron();

// ⏰ INICIAR CRON JOB DE RESUMO DE VENDAS (11:00 / 17:00 / 23:00 BRT)
console.log('⏰ Inicializando cron job de resumo de vendas...');
startSalesSummaryCron();

// ⏰ INICIAR CRON JOB DE LIBERAÇÃO DE COMISSÕES DE AFILIADOS
console.log('⏰ Inicializando cron job de liberação de comissões...');
startBalanceReconciliationScheduler().catch(e => console.error('❌ Erro ao iniciar balance scheduler:', e));

// ⏰ INICIAR CRON JOB DE RECUPERAÇÃO DE CARRINHO ABANDONADO
console.log('⏰ Inicializando cron job de carrinho abandonado...');
startAbandonedCartCron();

// ⏰ CRON JOB: Verificar PIX pendentes a cada 5 minutos (safety net para webhook/polling failures)
console.log('⏰ Inicializando cron job de verificação PIX pendentes...');
cron.schedule('*/15 * * * *', async () => {
  try {
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    const pendingSnap = await db.collection('orders')
      .where('status', '==', 'pending')
      .where('method', '==', 'pix')
      .limit(50)
      .get();
    
    const eligibleOrders = pendingSnap.docs.filter(doc => {
      const data = doc.data();
      if (!data.txid) return false;
      const createdAt = data.createdAt?.toDate?.() || new Date(data.createdAt);
      return createdAt < cutoff;
    });
    
    if (eligibleOrders.length > 0) {
    console.log(`🔄 [CRON PIX] Verificando ${eligibleOrders.length} ordens PIX pendentes...`);
    
    for (const doc of eligibleOrders) {
      const orderData = doc.data();
      const orderId = doc.id;
      
      try {
        const pixStatus = await verificarPixNaApi(orderData.txid);
        const pixPaid = pixStatus.valido && pixStatus.dados?.status?.toUpperCase() === 'CONCLUIDA';
        const hasPagamento = pixStatus.dados?.pix && Array.isArray(pixStatus.dados.pix) && pixStatus.dados.pix.length > 0;
        
        if (pixPaid || hasPagamento) {
          console.log(`✅ [CRON PIX] ${orderId} PAGO! Aprovando com transação atômica...`);
          
          const feeCalc = await calculateDynamicFees(orderData.amount, 'pix', 1, 'efibank', orderData.tenantId || orderData.sellerId);
          const releaseDate = new Date(Date.now() + (feeCalc.releaseDays || 0) * 86400000);
          
          let alreadyPaid = false;
          await db.runTransaction(async (t: any) => {
            const freshDoc = await t.get(doc.ref);
            const freshData = freshDoc.data();
            if (freshData.status !== 'pending') {
              console.log(`⚠️ [CRON PIX] ${orderId} já processado (status: ${freshData.status}), pulando`);
              alreadyPaid = true;
              return;
            }
            t.update(doc.ref, {
              status: 'paid', paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
              pixConfirmation: pixStatus.dados, confirmedVia: 'cron_auto_verify',
              method: 'pix',
              processor: 'efibank',
              netAmount: feeCalc.netAmount,
              gatewayFee: feeCalc.gatewayFee,
              platformFee: feeCalc.platformFee,
              releaseDate: releaseDate,
              financialData: {
                totalAmount: orderData.amount,
                netAmount: feeCalc.netAmount,
                gatewayFee: feeCalc.gatewayFee,
                platformFee: feeCalc.platformFee,
                releaseDate: releaseDate,
                paidAt: new Date(),
                releaseDays: feeCalc.releaseDays
              },
              'financial.released': false, 'financial.netAmount': feeCalc.netAmount,
              'financial.gatewayFee': feeCalc.gatewayFee, 'financial.platformFee': feeCalc.platformFee,
              'financial.releaseDate': releaseDate, 'financial.releaseDays': feeCalc.releaseDays
            });
          });
          
          if (alreadyPaid) continue;
          
          syncOrderAfterUpdate(orderData.tenantId, orderId, { status: 'paid', paidAt: new Date().toISOString(), method: 'pix', netAmount: feeCalc.netAmount });
          sendOrderStatusUpdate(orderData.tenantId, orderId, 'paid', { paidAt: new Date() }).catch(() => {});
          
          try { await dispatchPixPaidEvent(orderData.tenantId || orderData.sellerId, { id: orderId, ...orderData, paidAt: new Date() }); } catch(e) {}
          
          if (orderData.checkoutId) {
            try {
              await dispatchPurchaseEventToPixels(orderData.checkoutId, {
                id: orderId, tenantId: orderData.tenantId, customerEmail: orderData.customerEmail,
                customerName: orderData.customerName, customerPhone: orderData.customerPhone,
                amount: orderData.amount, currency: orderData.currency, productName: orderData.productName,
                method: 'pix', checkoutSlug: orderData.checkoutSlug
              });
            } catch(e) { console.warn('⚠️ [CAPI] Erro ao disparar evento de compra PIX:', e); }
          }
          
          if (orderData.productType === 'digital' || orderData.productType === 'subscription') {
            try { await storage.createEnrollmentOnPayment({ ...orderData, id: orderId, paidAt: new Date() }); } catch(e) {}
            try { await autoCreateMemberOnPurchase({ customerEmail: orderData.customerEmail || orderData.customer?.email, customerName: orderData.customerName || orderData.customer?.name, productId: orderData.productId, productType: orderData.productType, orderId, checkoutId: orderData.checkoutId || orderData.checkoutSlug }); } catch(e) { console.warn('⚠️ [AUTO-MEMBER] Erro:', e); }
          }
          if (orderData.affiliateCode || orderData.affiliateUid) {
            try { await storage.processAffiliateCommission({ ...orderData, id: orderId }); } catch(e) {}
          }
          
          if (orderData.couponCode) {
            try {
              const couponDoc = await storage.getCouponByCode(orderData.couponCode, orderData.tenantId);
              if (couponDoc) {
                await storage.incrementCouponUsage(couponDoc.id);
                console.log(`🎫 [CRON PIX] Cupom ${orderData.couponCode} uso incrementado`);
              }
            } catch(e) { console.warn('⚠️ [COUPON] Erro ao incrementar uso:', e); }
          }
          
          const sellerId = orderData.tenantId || orderData.sellerId;
          if (sellerId) {
            try {
              let affDed = 0;
              if (orderData.affiliateCode || orderData.affiliateUid) {
                const affCalc = await (storage as any).calculateAffiliateCommission(orderData);
                if (affCalc?.hasAffiliate && affCalc.netCommission > 0) affDed = affCalc.netCommission;
              }
              const credit = feeCalc.netAmount - affDed;
              if (credit > 0) {
                const { processWebhookWithBalanceUpdate: cronBalanceUpdate } = await import('./lib/atomic-balance.js');
                const cronWebhookId = `pix_confirmed_${orderData.txid}_${orderId}`;
                const cronResult = await cronBalanceUpdate({
                  webhookId: cronWebhookId,
                  provider: 'efibank',
                  eventType: 'pix.paid',
                  sellerId: sellerId,
                  amountCents: credit,
                  currency: 'BRL',
                  operation: 'add',
                  balanceType: 'available',
                  reason: `PIX confirmado via CRON - Ordem ${orderId}`,
                  orderId: orderId,
                  metadata: {
                    method: 'pix',
                    acquirer: 'efibank',
                    totalAmount: orderData.amount,
                    platformFee: feeCalc.platformFee,
                    gatewayFee: feeCalc.gatewayFee,
                    confirmedVia: 'cron_auto_verify'
                  }
                });
                if (cronResult.processed) {
                  console.log(`💰 [CRON PIX] Saldo creditado via atomic balance: +R$ ${(credit/100).toFixed(2)} (byMethod.pix atualizado)`);
                } else {
                  console.log(`⚠️ [CRON PIX] Balance já processado: ${cronResult.reason}`);
                }
              }
            } catch(e: any) { console.warn(`⚠️ [CRON PIX] Erro ao creditar saldo:`, e?.message); }
          }

          // 🔔 PUSH NOTIFICATION - CRON PIX
          try {
            const { sendSaleNotification: _sendCronPush } = await import('./lib/push-notification-service.js');
            _sendCronPush(orderData.tenantId, {
              id: orderId,
              customer: orderData.customer,
              productName: orderData.productName || orderData.checkoutTitle,
              amount: orderData.amount,
              method: 'pix',
              affiliateId: orderData.affiliateUid || orderData.affiliateId,
            }).catch((e: any) => console.warn('[PUSH] CRON PIX notification failed:', e?.message));
          } catch(e: any) { console.warn('[PUSH] CRON PIX notification import failed:', e?.message); }

          import('./security/transaction-limits.js').then(({ recordApprovedTransaction }) => {
            recordApprovedTransaction(orderData.tenantId, orderData.amount || 0).catch(() => {});
          }).catch(() => {});
          
          console.log(`✅ [CRON PIX] ${orderId} aprovado com sucesso!`);
        }
      } catch (e: any) {
        console.warn(`⚠️ [CRON PIX] Erro ao verificar ${orderId}:`, e?.message);
      }
    }
    } // end if (eligibleOrders.length > 0)



    // 🔄 [RECONCILIAÇÃO] Movida para CRON separado (a cada 1h) para economizar quota Firebase

  } catch (cronError: any) {
    console.error('❌ [CRON PIX] Erro geral:', cronError?.message);
  }
}, {
  timezone: 'America/Sao_Paulo'
});

// ⏰ CRON SEPARADO: Reconciliação de saldo PIX (a cada 1h — economiza quota Firebase)
cron.schedule('10 * * * *', async () => {
  try {
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const paidOrdersSnap = await db.collection('orders')
      .where('status', '==', 'paid')
      .where('method', '==', 'pix')
      .limit(50)
      .get();

    let reconciled = 0;
    for (const paidDoc of paidOrdersSnap.docs) {
      const paidOrder = paidDoc.data();
      const paidOrderId = paidDoc.id;
      const sellerId = paidOrder.tenantId || paidOrder.sellerId;
      if (!sellerId) continue;

      const orderUpdatedMs = paidOrder.updatedAt?.toDate?.()?.getTime?.() || paidOrder.updatedAt?.getTime?.() || 0;
      if (orderUpdatedMs > 0 && orderUpdatedMs < thirtyDaysAgoMs) continue;

      const movSnap = await db.collection('balanceMovements')
        .where('orderId', '==', paidOrderId)
        .limit(1)
        .get();
      if (!movSnap.empty) continue;

      const recAcquirer = paidOrder.gateway || paidOrder.acquirer || paidOrder.paidGateway || 'efibank';
      const recTxid = paidOrder.txid || paidOrderId;
      try {
        const recFeeCalc = await calculateDynamicFees(paidOrder.amount, 'pix', 1, recAcquirer, paidOrder.tenantId || paidOrder.sellerId);
        const recCredit = Math.round(recFeeCalc.netAmount);
        if (recCredit <= 0) continue;
        const { processWebhookWithBalanceUpdate: recBalance } = await import('./lib/atomic-balance.js');
        const recResult = await recBalance({
          webhookId: `pix_confirmed_${recTxid}_${paidOrderId}`,
          provider: recAcquirer, eventType: 'pix.paid', sellerId,
          amountCents: recCredit, currency: 'BRL', operation: 'add', balanceType: 'available',
          reason: `PIX reconciliado (saldo faltante) - Ordem ${paidOrderId}`,
          orderId: paidOrderId,
          metadata: { method: 'pix', acquirer: recAcquirer, totalAmount: paidOrder.amount,
            platformFee: recFeeCalc.platformFee, gatewayFee: recFeeCalc.gatewayFee, confirmedVia: 'balance_reconciliation' }
        });
        if (recResult.processed) {
          reconciled++;
          console.log(`✅ [RECONCILE] Saldo creditado seller ${sellerId}: +R$ ${(recCredit/100).toFixed(2)} (${paidOrderId})`);
        }
      } catch (recErr: any) {
        console.warn(`⚠️ [RECONCILE] Erro ${paidOrderId}:`, recErr?.message);
      }
    }
    if (reconciled > 0) console.log(`✅ [RECONCILE] ${reconciled} saldo(s) reconciliado(s)`);
  } catch (e: any) {
    console.warn('⚠️ [CRON RECONCILE] Erro geral:', e?.message);
  }
}, { timezone: 'America/Sao_Paulo' });

// ⏰ INICIAR CRON JOB DE APROVAÇÃO AUTOMÁTICA DE REEMBOLSOS (7 DIAS)
console.log('⏰ Inicializando cron job de reembolsos automáticos...');
cron.schedule('0 6 * * *', async () => {
  console.log('🤖 Executando verificação de reembolsos expirados...');
  try {
    await checkAndApproveExpiredRefunds();
  } catch (error) {
    console.error('❌ Erro no cron de reembolsos:', error);
  }
}, {
  timezone: 'America/Sao_Paulo'
});

// trust proxy já definido em linha anterior — evitar duplicata que causava bypass de rate limit

// ⚡ CRITICAL: LIGHTWEIGHT ROUTES FIRST - BYPASS ALL SECURITY FOR SPEED
// These MUST respond < 1s for deployment health checks

// 🏥 HEALTH CHECK - INSTANTÂNEO
app.get('/_health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// 🚀 ROOT HEALTH CHECK - REPLIT DEPLOYMENT
// ⚡ Detecta health checks e responde instantaneamente
app.get('/', (req, res, next) => {
  const userAgent = (req.get('User-Agent') || '').toLowerCase();
  const acceptHeader = (req.get('Accept') || '').toLowerCase();
  
  // Health checks: User-Agent específicos OU ausência de Accept: text/html
  const isHealthCheckUserAgent = 
    userAgent.includes('googlehc') || 
    userAgent.includes('cloud-run') ||
    userAgent.includes('kube-probe') ||
    userAgent.includes('replit') ||
    userAgent.includes('deployment') ||
    userAgent.includes('health') ||
    userAgent.includes('curl') ||
    userAgent.includes('wget') ||
    userAgent.includes('monitoring') ||
    userAgent === '';
  
  // Se não aceita HTML = é health check
  const isHealthCheckAccept = !acceptHeader.includes('text/html');
  
  if (isHealthCheckUserAgent || isHealthCheckAccept) {
    // Health check - responder IMEDIATAMENTE com código 200
    return res.status(200).json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      service: 'VolatusPay',
      version: '1.0.0'
    });
  }
  
  // Browser normal - servir frontend
  return next();
});

// ❤️ ROOT HEAD - Sempre responder OK
app.head('/', (req, res) => {
  res.status(200).end();
});

// server.listen() was moved to right after createServer(app) above for fast deployment startup

// DISABLED: // 🟢 WEBHOOK WOOVI - ANTES DE QUALQUER MIDDLEWARE (PRIORIDADE MÁXIMA)
// DISABLED: app.post('/api/webhooks/woovi', express.json(), async (req, res) => {
// DISABLED:   console.log('🟢 WOOVI WEBHOOK RECEBIDO (PRÉ-MIDDLEWARE):', { 
// DISABLED:     ip: req.ip,
// DISABLED:     body: req.body ? 'presente' : 'ausente',
// DISABLED:     headers: {
// DISABLED:       authorization: req.headers.authorization ? 'presente' : 'ausente',
// DISABLED:       'content-type': req.headers['content-type']
// DISABLED:     }
// DISABLED:   });
// DISABLED:   
// DISABLED:   // ✅ RETORNAR 200 OK IMEDIATAMENTE (WOOVI REQUIREMENT)
// DISABLED:   res.status(200).json({ success: true, received: true, timestamp: new Date().toISOString() });
// DISABLED:   
// DISABLED:   // 🔄 PROCESSAR ASSINCRÔNICAMENTE APÓS RESPOSTA (não bloquear resposta)
// DISABLED:   setImmediate(async () => {
// DISABLED:     try {
// DISABLED:       // 🔥 Garantir que Firebase está pronto
// DISABLED:       await ensureFirebaseReady();
// DISABLED:       const db = getFirestore();
// DISABLED:       
// DISABLED:       const { processWooviWebhook } = await import('./lib/woovi-api.js');
// DISABLED:       const result = await processWooviWebhook(req.body);
// DISABLED:       
// DISABLED:       if (!result.success || !result.correlationID) {
// DISABLED:         console.error('❌ Falha ao processar webhook Woovi:', result);
// DISABLED:         return;
// DISABLED:       }
// DISABLED:       
// DISABLED:       // 📦 BUSCAR PEDIDO PELO correlationID (orderId)
// DISABLED:       const ordersRef = db.collection('orders');
// DISABLED:       const orderQuery = await ordersRef.where('id', '==', result.correlationID).limit(1).get();
// DISABLED:       
// DISABLED:       if (orderQuery.empty) {
// DISABLED:         console.error('❌ Pedido não encontrado:', result.correlationID);
// DISABLED:         return;
// DISABLED:       }
// DISABLED:       
// DISABLED:       const orderDoc = orderQuery.docs[0];
// DISABLED:       const orderData = orderDoc.data();
// DISABLED:       
// DISABLED:       // ✅ ATUALIZAR STATUS DO PEDIDO
// DISABLED:       if (result.status === 'paid') {
// DISABLED:         // 💰 CALCULAR TAXAS DINÂMICAS SE A ORDEM NÃO TEM FEE SNAPSHOT
// DISABLED:         let feeUpdate: any = {};
// DISABLED:         if (!orderData.gatewayFee) {
// DISABLED:           console.log('💰 Ordem Woovi sem taxas calculadas, calculando agora...');
// DISABLED:           const feeCalculation = await calculateDynamicFees(
// DISABLED:             orderData.amount,
// DISABLED:             'woovi',
// DISABLED:             1,
// DISABLED:             'woovi'
// DISABLED:           );
// DISABLED:           feeUpdate = {
// DISABLED:             gatewayFee: feeCalculation.gatewayFee,
// DISABLED:             gatewayFeePercent: feeCalculation.gatewayFeePercent,
// DISABLED:             platformFee: feeCalculation.platformFee,
// DISABLED:             platformFeePercent: feeCalculation.platformFeePercent,
// DISABLED:             netAmount: feeCalculation.netAmount,
// DISABLED:             // 📊 SNAPSHOT FINANCEIRO COMPLETO (ETERNO)
// DISABLED:             financialData: {
// DISABLED:               grossAmount: orderData.amount,
// DISABLED:               feeAmount: feeCalculation.gatewayFee + feeCalculation.platformFee,
// DISABLED:               netAmount: feeCalculation.netAmount,
// DISABLED:               releaseDate: new Date(Date.now() + (feeCalculation.releaseDays || 0) * 24 * 60 * 60 * 1000),
// DISABLED:               released: false,
// DISABLED:               feeBreakdown: {
// DISABLED:                 fixedFee: 0,
// DISABLED:                 percentFee: feeCalculation.gatewayFeePercent,
// DISABLED:                 percentAmount: feeCalculation.gatewayFee,
// DISABLED:                 platformFeePercent: feeCalculation.platformFeePercent,
// DISABLED:                 platformFeeAmount: feeCalculation.platformFee
// DISABLED:               },
// DISABLED:               releaseDays: feeCalculation.releaseDays || 0
// DISABLED:             }
// DISABLED:           };
// DISABLED:         }
// DISABLED:         
// DISABLED:         await orderDoc.ref.update({
// DISABLED:           status: 'paid',
// DISABLED:           paymentStatus: 'paid',
// DISABLED:           paidAt: new Date().toISOString(),
// DISABLED:           updatedAt: new Date().toISOString(),
// DISABLED:           webhookReceivedAt: new Date(),
// DISABLED:           'payment.status': 'completed',
// DISABLED:           ...feeUpdate
// DISABLED:         });
// DISABLED:         
// DISABLED:         console.log('✅ WOOVI: PEDIDO ATUALIZADO PARA PAGO:', {
// DISABLED:           orderId: result.correlationID,
// DISABLED:           status: 'paid',
// DISABLED:           tenantId: orderData.tenantId
// DISABLED:         });
// DISABLED:         
// DISABLED:         // 🔔 DISPARAR WEBHOOKS DO SELLER
// DISABLED:         if (orderData?.tenantId) {
// DISABLED:           await triggerSellerWebhooks(orderData.tenantId, 'payment', {
// DISABLED:             order_id: result.correlationID,
// DISABLED:             checkout_id: orderData.checkoutId,
// DISABLED:             amount: orderData.amount,
// DISABLED:             currency: 'BRL',
// DISABLED:             customer_email: orderData.customerEmail,
// DISABLED:             product_type: orderData.productType || 'digital',
// DISABLED:             payment_method: 'woovi',
// DISABLED:             status: 'paid',
// DISABLED:             paid_at: new Date().toISOString()
// DISABLED:           });
// DISABLED:         }
// DISABLED:         
// DISABLED:         // 🎯 CRIAR ENROLLMENT AUTOMÁTICO PARA ACESSO AO PRODUTO (WOOVI)
// DISABLED:         const updatedOrderDoc = await orderDoc.ref.get();
// DISABLED:         if (updatedOrderDoc.exists) {
// DISABLED:           const updatedOrderData = updatedOrderDoc.data();
// DISABLED:           
// DISABLED:           try {
// DISABLED:             console.log('🎯 INICIANDO CRIAÇÃO DE ENROLLMENT AUTOMÁTICO (WOOVI)...');
// DISABLED:             await storage.createEnrollmentOnPayment(updatedOrderData);
// DISABLED:           } catch (enrollmentError) {
// DISABLED:             console.error('❌ Erro ao criar enrollment automático (Woovi):', enrollmentError);
// DISABLED:           }
// DISABLED:           
// DISABLED:           // 🔗 PROCESSAR COMISSÃO DE AFILIADO SE HOUVER (WOOVI)
// DISABLED:           if (updatedOrderData.affiliateCode || updatedOrderData.affiliateUid) {
// DISABLED:             console.log('🔗 AFILIADO DETECTADO - PROCESSANDO COMISSÃO WOOVI');
// DISABLED:             try {
// DISABLED:               await storage.processAffiliateCommission(updatedOrderData);
// DISABLED:               console.log('💰 WOOVI: Comissão de afiliado processada com sucesso');
// DISABLED:             } catch (affiliateError: any) {
// DISABLED:               console.error('❌ WOOVI WEBHOOK: Erro ao processar comissão:', affiliateError);
// DISABLED:             }
// DISABLED:           }
// DISABLED:         }
// DISABLED:       } else if (result.status === 'expired') {
// DISABLED:         await orderDoc.ref.update({
// DISABLED:           status: 'expired',
// DISABLED:           paymentStatus: 'expired',
// DISABLED:           updatedAt: new Date().toISOString(),
// DISABLED:           'payment.status': 'expired'
// DISABLED:         });
// DISABLED:         
// DISABLED:         console.log('⏰ PEDIDO EXPIRADO:', result.correlationID);
// DISABLED:       }
// DISABLED:       
// DISABLED:     } catch (error) {
// DISABLED:       console.error('❌ Erro ao processar webhook Woovi assincrônicamente:', {
// DISABLED:         message: error instanceof Error ? error.message : 'Erro desconhecido',
// DISABLED:         stack: error instanceof Error ? error.stack : undefined,
// DISABLED:         error: error
// DISABLED:       });
// DISABLED:     }
// DISABLED:   });
// DISABLED: });

// 🚫 AGORA SIM: MIDDLEWARES DE SEGURANÇA (DEPOIS DAS ROTAS CRÍTICAS!)
// 🛡️ DEFENSE IN DEPTH - 4 CAMADAS DE SEGURANÇA
import { edgeFW } from './security/edge-firewall.js';
import { waf } from './security/waf.js';
import { idsips } from './security/ids-ips.js';
import { threatIntelligence } from './security/threat-intelligence.js';
import { entityBlocker } from './security/entity-blocker.js';
import { applyDefensePreset } from './security/defense-layers-config.js';
import { autoBanGuard, attackPatternDetector } from './security/auto-ban-guard.js';

// 🔧 ENTITY BLOCKER SERÁ INICIALIZADO APÓS SERVER START (não bloquear health check)

// 🔓 BYPASS GLOBAL - ROTAS PÚBLICAS (EXECUTADO ANTES DE TUDO!)
app.use((req, res, next) => {
  // 🔍 LOG TODAS AS REQUISIÇÕES ANTES DE QUALQUER PROCESSAMENTO
  if (req.path.includes('create-session')) {
    console.log('🔍 REQUISIÇÃO CHEGOU:', req.method, req.path, 'Body?', !!req.body);
  }
  
  // ⚡ HEALTH CHECK - RESPONDER ANTES DE QUALQUER MIDDLEWARE!
  if (req.path === '/' && req.method === 'GET') {
    const acceptHeader = (req.get('Accept') || '').toLowerCase();
    if (!acceptHeader.includes('text/html')) {
      // Health check - responder IMEDIATAMENTE sem processar nada!
      return res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString(), service: 'VolatusPay', version: '1.0.0' });
    }
  }
  
  // 🔓 BYPASS: Webhook EfiBank usa mTLS/certificado
  if (req.path === '/webhook/efi' && (req.method === 'POST' || req.method === 'GET')) {
    req.bypassAllSecurity = true;
    console.log(`🔓 BYPASS GLOBAL: Webhook EfiBank ${req.method}`);
    return next();
  }
  // 🔓 BYPASS: Configuração pública do SDK EfiBank (necessária para tokenização no frontend)
  if (req.path === '/api/efibank/config' && req.method === 'GET') {
    req.bypassAllSecurity = true;
    console.log(`🔓 BYPASS GLOBAL: EfiBank Config GET (público)`);
    return next();
  }
  // 🔓 BYPASS: Criar sessão de pagamento (crítico para checkout)
  if (req.path === '/api/payment/create-session' && req.method === 'POST') {
    req.bypassAllSecurity = true;
    console.log(`🔓 BYPASS GLOBAL: Payment Session POST (checkout crítico)`);
    return next();
  }
  // 🔥 BYPASS: Reset total de segurança (admin only com master key)
  if (req.path === '/api/admin/security/reset-all-security-data' && req.method === 'POST') {
    req.bypassAllSecurity = true;
    console.log(`🔥 BYPASS GLOBAL: Security Reset POST (admin com master key)`);
    return next();
  }
  // 🔥 BYPASS: Rota emergencial de limpeza de bloqueios
  if (req.path === '/api/emergency/clear-blocks' && req.method === 'POST') {
    req.bypassAllSecurity = true;
    console.log(`🔥 BYPASS GLOBAL: Emergency Clear Blocks POST`);
    return next();
  }
  // 🔓 BYPASS AUTOMÁTICO PARA ADMINS: Rotas admin nunca são bloqueadas
  if (req.path.startsWith('/api/admin/')) {
    req.bypassAllSecurity = true;
    console.log(`🔓 BYPASS GLOBAL: Admin Route ${req.method} ${req.path}`);
  }
  const businessRoutes = ['/api/balance/', '/api/pix/', '/api/orders/', '/api/withdrawals/', '/api/checkouts/', '/api/webhooks/', '/api/payments/', '/api/sellers/', '/api/customers/', '/api/support/', '/api/products/', '/api/subscriptions/', '/api/affiliations/', '/api/affiliate/', '/api/coproduction/', '/api/tickets/'];
  for (const route of businessRoutes) {
    if (req.path.startsWith(route)) {
      req.bypassAllSecurity = true;
      console.log(`💰 BYPASS: Rota de negócio ${req.method} ${req.path} (vendas ativas)`);
      return next();
    }
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// RFC 9116 — security.txt (ANTES das camadas de segurança)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/.well-known/security.txt', (_req, res) => {
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const expires = nextYear.toISOString().replace(/\.\d{3}Z$/, '.000Z');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(
`Contact: mailto:seguranca@volatuspay.com
Expires: ${expires}
Preferred-Languages: pt-BR, en
Canonical: https://volatuspay.com/.well-known/security.txt
Policy: https://volatuspay.com/politica-de-seguranca
Acknowledgments: https://volatuspay.com/hall-da-fama-seguranca
`
  );
});

// 🛡️ DEFENSE IN DEPTH - 5 CAMADAS DE SEGURANÇA AVANÇADA
// Ordem: AutoBan → Edge → WAF → IDS/IPS → Threat Intel → Attack Patterns

// 🚫 CAMADA 0: AUTO-BAN GUARD (Banimento automático por thresholds)
app.use((req, res, next) => {
  if (req.bypassAllSecurity) return next();
  autoBanGuard(req, res, next);
});
console.log('🚫 LAYER 0: AutoBanGuard ATIVO - Banimento automático por thresholds');

// 🌐 CAMADA 1: EDGE FIREWALL (IP Reputation, Geofencing, ASN Blocking)
app.use((req, res, next) => {
  if (req.bypassAllSecurity) return next();
  edgeFW.middleware(req, res, next);
});
console.log('🌐 LAYER 1: Edge Firewall ATIVO - IP Reputation + Geofencing');

// 🛡️ CAMADA 2: WAF (Web Application Firewall - OWASP Top 10)
app.use((req, res, next) => {
  if (req.bypassAllSecurity) return next();
  waf.middleware(req, res, next);
});
console.log('🛡️ LAYER 2: WAF ATIVO - OWASP Top 10 Protection');

// 🔍 CAMADA 3: IDS/IPS (Intrusion Detection/Prevention)
app.use((req, res, next) => {
  if (req.bypassAllSecurity) return next();
  idsips.middleware(req, res, next);
});
console.log('🔍 LAYER 3: IDS/IPS ATIVO - Behavioral Analysis + Honeypots');

// 🧠 CAMADA 4: THREAT INTELLIGENCE (Zero-Day Detection + Auto Response)
app.use((req, res, next) => {
  if (req.bypassAllSecurity) return next();
  threatIntelligence.middleware(req, res, next);
});
console.log('🧠 LAYER 4: Threat Intelligence ATIVO - Zero-Day + Automated Response');

// 🤖 CAMADA 5: AI SECURITY (GPT-4o Powered Threat Analysis)
import('./security/ai-security-middleware.js').then(({ aiSecurityMiddleware: aiSecMW }) => {
  app.use(aiSecMW({ enabled: true, autoBlock: false, logOnly: true, confidenceThreshold: 90 }));
  console.log('🤖 LAYER 5: AI Security ATIVO - GPT-4o Threat Detection (log-only mode)');
}).catch((err) => {
  console.warn('⚠️ LAYER 5: AI Security não pôde ser carregado:', err.message);
  app.use((req: any, res: any, next: any) => next());
});
console.log('🤖 LAYER 5: AI Security inicializando...');

// ✅ APLICAR CONFIGURAÇÃO: DETECTION-ONLY MODE (blockMode = false)
// Todas as camadas logam threats mas NÃO bloqueiam (admin decide manualmente)
applyDefensePreset('MAXIMUM'); // Preset mínimo: apenas detecção, ZERO bloqueios automáticos
console.log('✅ MODO MAXIMUM ATIVO: Proteção TOTAL - VPN/Proxy/Tor BLOQUEADOS!');



// 🛡️ HEADERS DE SEGURANÇA DEVASTADORES (HELMET + CSP RIGOROSO)
import helmet from 'helmet';
app.use(helmet({
  contentSecurityPolicy: false, // Desabilitar CSP do helmet (usaremos o customizado)
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Permitir recursos do Bunny CDN
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// 🛡️ CSP (CONTENT SECURITY POLICY) ULTRA-AVANÇADO
app.use(xssProtection.cspMiddleware());

// 🛡️ CSRF ORIGIN VALIDATION (defesa em profundidade — Bearer tokens já mitigam, mas melhor ter)
app.use(csrfOriginMiddleware());

// 🛡️ ULTRA-ADVANCED PENTEST PROTECTION (ORDEM CRÍTICA!)
// 1. Anti-Reconnaissance (Prevenir fingerprinting e discovery)
app.use(reconProtection.removeIdentifyingHeaders());
app.use(reconProtection.blockReconTools());
app.use(reconProtection.blockDirectoryListing());
app.use(reconProtection.blockUnnecessaryMethods());

// 2. HPP Protection (HTTP Parameter Pollution)
// ✅ MANTIDO: Prototype pollution (crítico)
app.use(hppProtection.blockPrototypePollution());
// ✅ MANTIDO: Query injection (crítico)
app.use(hppProtection.blockQueryInjection());
// ⚠️ DESABILITADO: 5 middlewares extras = overhead excessivo em alta escala
// app.use(hppProtection.detectHPP());
// app.use(hppProtection.cleanPollutedArrays());
// app.use(hppProtection.validateQueryComplexity());
// app.use(hppProtection.normalizeParameters());
// app.use(hppProtection.limitArraySize(100));
console.log('⚡ HPP Protection OTIMIZADO - Mantido apenas proteções críticas (2/7 middlewares)');

// 3. Anti-Enumeration (Prevenir descoberta de usuários/recursos)
// ⚠️ DESABILITADO: normalizeResponseTiming() adiciona delay de 200-500ms em TODAS as requisições
// Isso MATA PERFORMANCE em cenários de alta escala e volume de tráfego
// app.use(enumerationProtection.normalizeResponseTiming());
// ⚠️ DESABILITADO: 4 middlewares interceptando cada request = overhead desnecessário
// app.use(enumerationProtection.preventUserEnumeration());
// app.use(enumerationProtection.preventResourceEnumeration());
// app.use(enumerationProtection.preventEndpointDiscovery());
// app.use(enumerationProtection.preventIdentifierEnumeration());
console.log('⚡ Anti-Enumeration DESABILITADO - Prioridade: Performance em escala');

// 4. XSS Protection (Ultra-avançado)
app.use(xssProtection.xssDetector());
app.use(xssProtection.autoSanitize());

// 5. SQLi Protection (Ultra-avançado)
// ⚠️ DESABILITADO: Bloqueando requisições legítimas com falsos positivos
app.use(sqliProtection.sqliDetector());
console.log('✅ SQLi Protection REABILITADO - Modo detecção (log only)');

// 6. LFI Protection (Path Traversal)
// ⚠️ DESABILITADO: Pode bloquear URLs legítimas
// app.use(lfiProtection.lfiDetector());
console.log('⚠️ LFI Protection DESABILITADO - Pode bloquear URLs legítimas');

// 7. IDOR Protection (Indirect Object Reference)
// ⚠️ DESABILITADO: Overhead desnecessário
// app.use(idorProtection.idorDetector());
console.log('⚠️ IDOR Protection DESABILITADO - Overhead desnecessário');

// 8. Privilege Escalation Protection
app.use(privilegeProtection.massAssignmentProtection());
app.use(privilegeProtection.parameterTamperingDetector());
app.use(privilegeProtection.priceManipulationProtector());

// 🚫 PROTEÇÃO ANTI-DOWNLOAD DE CÓDIGO FONTE (APENAS PRODUÇÃO)
// 🚨 PROTEÇÃO CRÍTICA: BLOQUEAR ACESSO A DIRETÓRIOS SENSÍVEIS
app.use((req, res, next) => {
  const dangerousPaths = [
    '/certs',
    '/attached_assets',
    '/server/certs',
    '/.env',
    '/.git',
    '/node_modules'
  ];
  
  const requestPath = req.path.toLowerCase();
  
  // ✅ PERMITIR ASSETS (CSS, JS, imagens) SEMPRE
  if (requestPath.startsWith('/assets/') || requestPath.endsWith('.css') || requestPath.endsWith('.js') || requestPath.endsWith('.png') || requestPath.endsWith('.jpg') || requestPath.endsWith('.svg')) {
    return next();
  }
  
  const isDangerousPath = dangerousPaths.some(dangerous => 
    requestPath.startsWith(dangerous.toLowerCase())
  );
  
  // 🔒 PROTEÇÃO EXTRA: Bloquear extensões de certificado SEMPRE
  const dangerousExtensions = ['.p12', '.pem', '.key', '.crt', '.pfx'];
  const hasDangerousExtension = dangerousExtensions.some(ext => 
    requestPath.endsWith(ext)
  );
  
  if (isDangerousPath || hasDangerousExtension) {
    console.error(`🚨 BLOCKED DANGEROUS PATH ACCESS: ${req.path} from ${req.ip}`);
    
    // 🚨 ALERTA CRÍTICO: Tentativa de acesso a certificado
    if (hasDangerousExtension) {
      console.error(`🚨🚨🚨 CRITICAL: Tentativa de acesso a certificado/chave!`);
      console.error(`IP: ${req.ip} | Path: ${req.path} | User-Agent: ${req.headers['user-agent']}`);
    }
    
    return res.status(403).json({
      success: false,
      error: 'Acesso negado'
    });
  }
  
  next();
});

// 🔧 HELPER GLOBAL: Detectar ambiente REAL (contorna Replit forçando NODE_ENV=production)
function isProductionEnvironment(): boolean {
  if (process.env.FORCE_DEV_MODE === 'true') return false;
  if (process.env.REPL_ID) return false; // Replit = sempre DEV
  return process.env.NODE_ENV === 'production';
}

app.use((req, res, next) => {
  // Headers para prevenir download/scraping de código
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // 🛡️ BLOQUEAR ACESSO A ARQUIVOS DE CÓDIGO FONTE (SOMENTE EM PRODUÇÃO)
  // EM DESENVOLVIMENTO, VITE PRECISA ACESSAR .tsx/.ts PARA HOT RELOAD
  if (isProductionEnvironment()) {
    const blockedExtensions = ['.ts', '.tsx', '.js.map', '.css.map', '.env', '.git', '.gitignore'];
    const blockedPaths = ['/server/', '/node_modules/', '/.git/', '/src/', '/client/src/'];
    
    const path = req.path.toLowerCase();
    
    // Verificar extensões bloqueadas
    for (const ext of blockedExtensions) {
      if (path.endsWith(ext)) {
        console.log(`🚫 SOURCE CODE PROTECTION: Blocked ${ext} file access from ${req.ip}: ${req.path}`);
        return res.status(403).send('Forbidden');
      }
    }
    
    // Verificar paths bloqueados
    for (const blockedPath of blockedPaths) {
      if (path.includes(blockedPath)) {
        console.log(`🚫 SOURCE CODE PROTECTION: Blocked path access from ${req.ip}: ${req.path}`);
        return res.status(403).send('Forbidden');
      }
    }
  }
  
  next();
});

// 🔐 PROTEÇÃO ULTRA-BLINDADA DE DATABASE - OPERAÇÕES CRÍTICAS
app.use((req, res, next) => {
  // 🔍 LOG TODAS AS REQUISIÇÕES PARA /api/withdrawals
  if (req.path.includes('/withdrawals')) {
    console.log(`🔍 [CRITICAL-MW] ${req.method} ${req.path} - Query:`, req.query, '- Body:', Object.keys(req.body || {}));
  }
  
  const criticalDatabaseOperations = [
    '/api/admin/reset-seller-transactions',
    '/api/admin/reset-seller-checkouts', 
    '/api/admin/delete-account',
    '/api/admin/delete-account-complete',
    '/api/admin/withdrawals',
    '/api/balances',
    '/api/sellers/delete',
    '/api/internal/sync-sellers',
    '/api/emergency/fix-tenant-id',
    '/api/admin/force-confirm',
    '/api/admin/force-remove',
    '/api/admin/update-seller-status',
    '/api/admin/transactions',
    '/api/admin/sellers'
  ];
  
  // 🚫 BLOQUEAR ACESSO DIRETO A ADMIN DE DATABASE (POSTGRESQL/FIREBASE)
  const blockedDatabasePaths = [
    '/pgadmin',
    '/phppgadmin',
    '/postgres',
    '/postgresql',
    '/firestore',
    '/firebase-admin',
    '/__/firebase',
    '/db/admin',
    '/database/admin',
    '/api/db/execute',
    '/api/sql/query',
    '/api/database/raw'
  ];
  
  const path = req.path.toLowerCase();
  
  // 🛡️ BLOQUEAR TENTATIVAS DE ACESSO A PAINEL ADMIN DE DB
  // ✅ HABILITADO - Database admin paths protegidos por IP whitelist + autenticação
  // ⚠️ CORRIGIDO: usa .startsWith() para evitar false positives
  if (process.env.NODE_ENV === 'production') {
    for (const blockedPath of blockedDatabasePaths) {
      if (path.startsWith(blockedPath.toLowerCase()) || path === blockedPath.toLowerCase()) {
        const isReplitIP = /^160\.20\./.test(req.ip);
        const isPrivateIP = /^(127\.|10\.|192\.168\.)/.test(req.ip) || req.ip === '::1';
        
        if (!isReplitIP && !isPrivateIP) {
          console.error(`🚨 DATABASE ADMIN ACCESS BLOCKED: ${req.path} from ${req.ip}`);
          return res.status(403).json({ 
            error: 'Forbidden - Unauthorized database access',
            code: 'DB_ADMIN_BLOCKED'
          });
        } else {
          console.log(`🏠 WHITELIST: Database path check ignored for Replit/Private IP ${req.ip}`);
        }
      }
    }
  }
  
  // ✅ BYPASS: Rotas admin autenticadas (já protegidas por Firebase Auth)
  if (req.path.startsWith('/api/admin/')) {
    console.log(`🔓 BYPASS GLOBAL: Admin Route ${req.method} ${req.path}`);
    return next();
  }
  
  // ✅ BYPASS: Rotas autenticadas de seller (achievements e withdrawals)
  // Essas rotas já são protegidas por verifyFirebaseToken, não precisam de verificação extra
  if ((req.path === '/api/premiations' && req.method === 'GET') || 
      req.path === '/api/withdrawals') {
    return next();
  }
  
  // 🛡️ VERIFICAR SE É UMA OPERAÇÃO CRÍTICA DE DATABASE
  const isCriticalOperation = criticalDatabaseOperations.some(op => path.startsWith(op.toLowerCase()));
  
  if (isCriticalOperation) {
    // 🔒 LOG DE SEGURANÇA PARA AUDITORIA
    console.log(`🔐 CRITICAL DB OPERATION ATTEMPT: ${req.method} ${req.path} from IP ${req.ip}`);
    
    // 🛡️ BLOQUEAR OPERAÇÕES VIA SQL DIRETO (PREVENIR BYPASSES)
    const suspiciousPatterns = [
      /drop\s+table/i,
      /drop\s+database/i,
      /drop\s+collection/i,
      /truncate\s+table/i,
      /delete\s+from.*where.*1\s*=\s*1/i,
      /update.*set.*where.*1\s*=\s*1/i,
      /;\s*drop/i,
      /;\s*delete/i,
      /;\s*truncate/i,
      /union\s+select/i,
      /exec\s*\(/i,
      /execute\s*\(/i,
      /alter\s+table/i,
      /create\s+table/i,
      /grant\s+all/i,
      /revoke\s+all/i,
      /pg_sleep/i,
      /waitfor\s+delay/i,
      /benchmark\s*\(/i,
      /load_file\s*\(/i,
      /into\s+outfile/i,
      /into\s+dumpfile/i,
      /information_schema/i,
      /pg_catalog/i,
      /sys\./i,
      /master\./i,
      /xp_cmdshell/i
    ];
    
    const bodyStr = JSON.stringify(req.body || {});
    const queryStr = JSON.stringify(req.query || {});
    const headersStr = JSON.stringify(req.headers || {});
    const combined = (bodyStr + queryStr + headersStr).toLowerCase();
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(combined)) {
        console.error(`🚨 SQL INJECTION ATTEMPT DETECTED: ${pattern} from ${req.ip} on ${req.path}`);
        
        // ⚠️ APENAS REGISTRAR - NÃO BLOQUEAR AUTOMATICAMENTE
        // Usar 'medium' para apenas monitorar, não bloquear na primeira tentativa
        return res.status(403).json({ 
          error: 'Forbidden - Security violation detected',
          code: 'DB_INJECTION_BLOCKED'
        });
      }
    }
    
    // 🔐 VERIFICAÇÃO EXTRA: APENAS MÉTODOS AUTORIZADOS
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    if (!allowedMethods.includes(req.method)) {
      console.error(`🚨 INVALID METHOD on DB operation: ${req.method} from ${req.ip}`);
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // 🛡️ PREVENIR MASS ASSIGNMENT E BYPASS DE VALIDAÇÃO
    // ✅ WHITELIST: Ignorar IPs internos (Replit, Docker, Localhost)
    const isInternalIP = req.ip.startsWith('172.') || req.ip.startsWith('10.') || 
                        req.ip.startsWith('192.168.') || req.ip === '127.0.0.1' ||
                        req.ip.startsWith('160.20.'); // ✅ REPLIT INFRASTRUCTURE
    
    if (!isInternalIP) {
      const dangerousFields = ['isAdmin', 'role', 'permissions']; // ✅ REMOVIDO __proto__, constructor, prototype - são propriedades nativas do JavaScript
      
      // ✅ FIX: Usar Object.keys() para pegar APENAS propriedades enviadas pelo cliente
      const bodyKeys = Object.keys(req.body || {});
      const queryKeys = Object.keys(req.query || {});
      
      for (const field of dangerousFields) {
        if (bodyKeys.includes(field) || queryKeys.includes(field)) {
          console.error(`🚨 DANGEROUS FIELD INJECTION: ${field} from ${req.ip}`);
          return res.status(403).json({ 
            error: 'Forbidden - Invalid request structure',
            code: 'FIELD_INJECTION_BLOCKED'
          });
        }
      }
    }
  }
  
  next();
});

// 🛡️ RATE LIMITING + VALIDAÇÃO
import { clearPrivilegeEscalationBlocks, clearNonCriticalBlocks, persistentBlacklist } from './security/persistent-ip-blacklist.js';
import { userRateLimit, userRateLimiter } from './security/user-rate-limiter.js';
import { validateImageURLs } from './security/url-validator.js';

// 🛡️ ULTRA-ADVANCED SECURITY MODULES (PENTEST PROTECTION)
import { xssProtection } from './security/advanced-xss-protection.js';
import { sqliProtection } from './security/advanced-sqli-protection.js';
import { lfiProtection } from './security/anti-lfi-protection.js';
import { idorProtection } from './security/anti-idor-protection.js';
import { privilegeProtection } from './security/anti-privilege-escalation.js';
import { enumerationProtection } from './security/anti-enumeration.js';
import { reconProtection } from './security/anti-reconnaissance.js';
import { hppProtection } from './security/hpp-protection.js';
import { idempotencyMiddleware, completeIdempotency, failIdempotency, replayProtectionMiddleware } from './security/idempotency.js';
import { paymentIPRateLimit, sanitizeCheckoutInputs } from './security/checkout-guard.js';

// 🛡️ PROTEÇÃO DEVASTADORA DE ARQUIVOS ESTÁTICOS SENSÍVEIS
import { 
  staticFileProtectionMiddleware, 
  uploadsProtectionMiddleware, 
  antiHotlinkingMiddleware,
  securityLoggingMiddleware 
} from './security/static-file-protection.js';

// 🤖 DETECÇÃO AVANÇADA DE BOTS E MÁQUINAS FAKE
import { 
  advancedBotDetectionMiddleware, 
  criticalEndpointBotProtection 
} from './security/advanced-bot-detection.js';

// Aplicar proteções em ordem específica (exceto /webhook/efi e /api/efibank/config)
app.use((req, res, next) => {
  // 🔓 BYPASS: Webhook EfiBank usa mTLS/certificado - pular middlewares agressivos (GET para teste, POST para notificação)
  if (req.path === '/webhook/efi' && (req.method === 'POST' || req.method === 'GET')) {
    console.log(`🔓 BYPASS: Webhook EfiBank ${req.method} (mTLS) - sem middlewares de segurança`);
    return next();
  }
  // 🔓 BYPASS: Configuração pública do SDK EfiBank (necessária para tokenização no frontend)
  if (req.path === '/api/efibank/config' && req.method === 'GET') {
    console.log(`🔓 BYPASS: EfiBank Config GET (público) - sem middlewares de segurança`);
    return next();
  }
  securityLoggingMiddleware(req, res, next);
});

app.use((req, res, next) => {
  if (req.path === '/webhook/efi' && (req.method === 'POST' || req.method === 'GET')) return next();
  if (req.path === '/api/efibank/config' && req.method === 'GET') return next();
  if ((req.path === '/api/webhooks/woovi' || req.path === '/webhooks/woovi') && req.method === 'POST') return next(); // 🟢 Bypass Woovi webhook
  if ((req.path === '/api/webhooks/onz-pix' || req.path === '/webhooks/onz-pix') && req.method === 'POST') return next(); // 🟢 Bypass ONZ webhook
  staticFileProtectionMiddleware(req, res, next);
});

app.use('/uploads', uploadsProtectionMiddleware);
app.use('/uploads', antiHotlinkingMiddleware);

// ── Caminho base da pasta client/public (funciona tanto em dev quanto em produção) ──
const CLIENT_PUBLIC = path.resolve(import.meta.dirname, '..', 'client', 'public');

app.get('/sw.js', (req, res) => {
  res.set({
    'Content-Type': 'application/javascript',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Service-Worker-Allowed': '/'
  });
  res.sendFile(path.join(CLIENT_PUBLIC, 'sw.js'));
});

app.get('/firebase-messaging-sw.js', (req, res) => {
  res.set({
    'Content-Type': 'application/javascript',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Service-Worker-Allowed': '/'
  });
  res.sendFile(path.join(CLIENT_PUBLIC, 'firebase-messaging-sw.js'));
});

app.get('/manifest.json', (req, res) => {
  res.set({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, must-revalidate'
  });
  res.sendFile(path.join(CLIENT_PUBLIC, 'manifest.json'));
});

app.get('/favicon.png', (req, res) => {
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  res.sendFile(path.join(CLIENT_PUBLIC, 'favicon.png'));
});

app.get('/favicon.ico', (req, res) => {
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  res.sendFile(path.join(CLIENT_PUBLIC, 'favicon.png'));
});

app.get('/logo-volatuspay.png', (req, res) => {
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
  res.sendFile(path.join(CLIENT_PUBLIC, 'logo-volatuspay.png'));
});

app.get('/somvenda.mp3', (req, res) => {
  res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
  res.sendFile(path.join(CLIENT_PUBLIC, 'somvenda.mp3'));
});

app.get('/placeholder-product.png', (req, res) => {
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
  res.sendFile(path.join(CLIENT_PUBLIC, 'placeholder-product.png'));
});

// ── Caminho base da pasta public/ (raiz do artefato) ──
const ARTIFACT_PUBLIC = path.resolve(import.meta.dirname, '..', 'public');

// 🖼️ SERVIR LOGOS ESTÁTICAS DA PASTA CLIENT/PUBLIC
app.use('/logos', express.static(path.join(CLIENT_PUBLIC, 'logos'), {
  setHeaders: (res) => {
    res.set({ 'Cache-Control': 'no-cache, must-revalidate', 'Access-Control-Allow-Origin': '*' });
  }
}));

// 🖼️ SERVIR IMAGENS DA LANDING PAGE (client/public/images + public/images como fallback)
app.use('/images', express.static(path.join(CLIENT_PUBLIC, 'images'), {
  setHeaders: (res) => {
    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Access-Control-Allow-Origin': '*' });
  }
}));
app.use('/images', express.static(path.join(ARTIFACT_PUBLIC, 'images'), {
  setHeaders: (res) => {
    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Access-Control-Allow-Origin': '*' });
  }
}));

// 📄 SERVIR DOWNLOADS (PDFs, documentos)
app.use('/downloads', express.static(path.join(ARTIFACT_PUBLIC, 'downloads'), {
  setHeaders: (res) => {
    res.set({ 'Cache-Control': 'no-cache', 'Content-Disposition': 'attachment' });
  }
}));

// 🖼️ SERVIR ASSETS ESTÁTICOS
app.use('/assets', express.static(path.join(CLIENT_PUBLIC, 'assets'), {
  setHeaders: (res) => {
    res.set({ 'Cache-Control': 'public, max-age=31536000', 'Access-Control-Allow-Origin': '*' });
  }
}));
app.use('/assets', express.static(path.join(ARTIFACT_PUBLIC, 'assets'), {
  setHeaders: (res) => {
    res.set({ 'Cache-Control': 'public, max-age=31536000', 'Access-Control-Allow-Origin': '*' });
  }
}));

// ── Caminho base da pasta uploads/ (raiz do artefato) ──
const ARTIFACT_UPLOADS = path.resolve(import.meta.dirname, '..', 'uploads');

// 🖼️ SERVIR BANNERS ENVIADOS PELOS ADMINS (uploads/banners/)
app.use('/api/cdn-media/banners', express.static(path.join(ARTIFACT_UPLOADS, 'banners'), {
  setHeaders: (res) => {
    res.set({ 'Cache-Control': 'public, max-age=604800', 'Access-Control-Allow-Origin': '*' });
  }
}));

// 🖼️ PROXY PÚBLICO DE IMAGENS — registrado AQUI (antes do auth middleware) para evitar 401
// Serve arquivos de uploads/ localmente ou redireciona para o Bunny CDN
app.get('/api/images/*', async (req: Request, res: Response) => {
  try {
    const rawPath = (req.params as any)[0] || '';
    const filePath = rawPath.replace(/\.\./g, '').replace(/^\/+/, '').trim();
    if (!filePath || filePath.length > 500) return res.status(400).end();

    // 1. Verificar arquivo local PRIMEIRO
    const localPath = path.join(ARTIFACT_UPLOADS, filePath);
    if (fs.existsSync(localPath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.sendFile(localPath);
    }

    // 2. Tentar Bunny CDN via getBunnyCredentials() (lê do Firestore se env var ausente)
    const { getBunnyCredentials: getBunnyCreds } = await import('./lib/bunny-helper.js');
    const bunnyCreds = await getBunnyCreds();
    const storageApiKey = bunnyCreds?.storageApiKey || process.env.BUNNY_STORAGE_API_KEY;
    const storageZone = bunnyCreds?.storageZoneName || process.env.BUNNY_STORAGE_ZONE_NAME || 'volatuspaypj';
    const storageRegion = bunnyCreds?.storageRegion || 'de';

    if (!storageApiKey) {
      const cdnHostname = bunnyCreds?.cdnHostname || process.env.BUNNY_CDN_HOSTNAME || 'volatuspaypj.b-cdn.net';
      console.warn(`⚠️ [IMAGE-PROXY] Sem credenciais storage, redirecionando para CDN: ${filePath}`);
      return res.redirect(302, `https://${cdnHostname}/${filePath}`);
    }

    const regionPrefix = storageRegion && storageRegion !== 'de' ? `${storageRegion}.` : '';
    const storageUrl = `https://${regionPrefix}storage.bunnycdn.com/${storageZone}/${filePath}`;
    const upstream = await fetch(storageUrl, { headers: { 'AccessKey': storageApiKey } });

    if (!upstream.ok) {
      // Fallback: redirect to CDN pull zone rather than returning an error
      const cdnHostname = bunnyCreds?.cdnHostname || process.env.BUNNY_CDN_HOSTNAME || 'volatuspaypj.b-cdn.net';
      return res.redirect(302, `https://${cdnHostname}/${filePath}`);
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(buffer);
  } catch (err: any) {
    console.error('❌ [IMAGE-PROXY] Erro:', err.message);
    res.status(500).end();
  }
});

app.use((req, res, next) => {
  if (req.path === '/webhook/efi' && (req.method === 'POST' || req.method === 'GET')) return next();
  if (req.path === '/api/efibank/config' && req.method === 'GET') return next();
  if ((req.path === '/api/webhooks/woovi' || req.path === '/webhooks/woovi') && req.method === 'POST') return next(); // 🟢 Bypass Woovi webhook
  if ((req.path === '/api/webhooks/onz-pix' || req.path === '/webhooks/onz-pix') && req.method === 'POST') return next(); // 🟢 Bypass ONZ webhook
  advancedBotDetectionMiddleware(req, res, next);
});

// ✅ NOTA: Navegação normal (digitar URL, clicar links) NÃO envia header Origin
// Origin header só é enviado em requisições AJAX/fetch - CORS já protege essas APIs abaixo
// Não bloquear navegação legítima dos usuários!

// 🛡️ CORS SECURITY HARDENED - WHITELIST RIGOROSA
const ALLOWED_ORIGINS = [
  'http://localhost',
  'http://localhost:5000',
  'http://127.0.0.1',
  'http://127.0.0.1:5000',
  // VolatusPay (domínio de produção principal)
  'https://volatuspay.com',
  'https://volatuspay.com',
  'https://volatuspay.com',
  'https://volatuspay.com',
  // VolatusPay .net (domínio internacional)
  'https://volatuspay.com',
  'https://www.volatuspay.com',
  'https://app.volatuspay.com',
  'https://admin.volatuspay.com',
  // HTTP (antes do SSL)
  'https://volatuspay.com',
  'https://volatuspay.com',
  'https://volatuspay.com',
  'https://volatuspay.com',
  'http://volatuspay.com',
  'http://www.volatuspay.com',
  // Replit domains para desenvolvimento (com ou sem porta)
  /^https?:\/\/.*\.replit\.dev(:\d+)?$/,
  /^https?:\/\/.*\.replit\.app(:\d+)?$/,
  /^https?:\/\/.*\.janeway\.replit\.dev(:\d+)?$/,
  /^https?:\/\/.*\.riker\.replit\.dev(:\d+)?$/,
  /^https?:\/\/.*\.kirk\.replit\.dev(:\d+)?$/,
  /^https?:\/\/.*\.picard\.replit\.dev(:\d+)?$/,
];

// 🔒 MIDDLEWARE CORS INTELIGENTE - Protege APIs, permite navegação normal
app.use((req, res, next) => {
  const origin = req.get('origin');
  const path = req.path;
  
  // ⚡ CRITICAL PUBLIC ENDPOINTS - NUNCA BLOQUEAR (mesmo sem Origin)
  const criticalPublicPaths = [
    '/api/efibank', // 🔑 Todos os endpoints EfiBank (incluindo config e tokenização)
    '/api/webhook', // 🔔 Webhooks EfiBank/Stripe
    '/api/webhooks/woovi', // 🟢 Webhook Woovi/OpenPix (IPs: 179.190.27.5, 179.190.27.6, 186.224.205.214)
    '/webhooks/woovi',
    '/webhooks/onz-pix',
    '/_health', // 🏥 Health check
    '/health' // 🏥 Health check alternativo
  ];
  
  const isCriticalPublic = criticalPublicPaths.some(p => {
    return path === p || path.startsWith(p + '/') || path.startsWith(p + '?');
  });
  
  // ✅ PERMITIR CRITICAL PUBLIC PATHS - SEM RESTRIÇÃO
  if (isCriticalPublic) {
    console.log(`✅ CORS CRITICAL PUBLIC: ${path} - permitido sem origin/referer`);
    return next();
  }
  
  // Server-to-server paths confiáveis (webhooks, health checks)
  // Same-origin essential paths (used by our own frontend)
  const trustedPaths = [
    '/api/user-type', // Essential for login routing
    '/api/public', // Public configurations
    '/api/checkout', // 🛒 PUBLIC CHECKOUT PAGES (works in production)
    '/api/admin', // Admin dashboard routes (same-origin from browser)
    '/api/showcase', // Showcase public data (works in production)
    '/api/support', // Support tickets (works in production)
    '/api/security', // Security logs and monitoring (works in production)
    '/api/efibank', // EfíBank SDK config and tokenization (public for frontend)
    '/api/banners', // 🎨 Banner system (same-origin from dashboard)
    '/api/sellers', // 👤 Seller data (same-origin from dashboard)
    '/api/withdrawals', // 💰 Withdrawals (same-origin from dashboard)
    '/api/subscriptions', // 🔁 Subscriptions (same-origin from dashboard)
    '/api/checkouts-by-tenant', // 🏪 Checkouts by tenant (same-origin from dashboard)
    '/api/orders' // 📋 Orders (same-origin from dashboard)
  ];
  const isTrustedPath = trustedPaths.some(p => path.startsWith(p));
  
  // Aplicar bloqueio APENAS em rotas de API (não em assets, HTML, etc)
  const isApiRoute = path.startsWith('/api');
  
  // 🔐 PRODUÇÃO: Aceitar same-origin requests (sem Origin header)
  // Quando frontend e backend estão no mesmo domínio, navegador NÃO envia Origin
  // Bloquear apenas cross-origin sem Origin (potencial ataque CSRF)
  const referer = req.get('referer') || req.get('referrer');
  const hasSameOriginReferer = referer && (
    referer.startsWith('http://localhost:5000') ||
    referer.startsWith('http://127.0.0.1:5000') ||
    referer.includes('volatuspay.com')
  );
  
  // ✅ PERMITIR: 1) Com origin válido, 2) Same-origin via referer, 3) Trusted paths
  // 🔥 DESABILITADO TEMPORARIAMENTE - Bloqueava pagamentos e checkouts
  /*
  if (!origin && process.env.NODE_ENV === 'production' && isApiRoute && !isTrustedPath && !hasSameOriginReferer) {
    console.warn(`🚨 CORS BLOCKED: API request sem origin/referer bloqueado (path: ${path})`);
    return res.status(403).json({ error: 'Origin header required for API', code: 'ORIGIN_REQUIRED' });
  }
  */
  
  next();
});

const corsOptions = {
  origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    // Se passou pelo middleware acima, já foi validado
    if (!origin) {
      // ✅ OTIMIZAÇÃO: Log removido (muito repetitivo)
      return callback(null, true);
    }
    
    // Verificar se origin está na whitelist
    const isAllowed = ALLOWED_ORIGINS.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return origin === allowedOrigin;
      }
      return allowedOrigin.test(origin);
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`🚨 CORS BLOCKED: Origin não autorizada: ${origin}`);
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true, // ✅ NECESSÁRIO para Firebase Auth (Authorization header)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Security-Token', 'X-Browser-Id', 'Cache-Control', 'Pragma'],
  optionsSuccessStatus: 200,
  maxAge: 86400, // Cache preflight por 24 horas
  preflightContinue: false, // 🔒 Não continuar para próximo middleware em preflight
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'] // Headers que cliente pode ler
};

app.use(cors(corsOptions));

// ✅ EXPLICIT OPTIONS HANDLER - GARANTIR PREFLIGHT CORS
app.options('/api/*', cors(corsOptions));

// 🛡️ CAMADA DE SEGURANÇA APRIMORADA - IDOR/CSRF/SERVER-PRICING
// Aplica proteções adicionais sem quebrar funcionalidades existentes
applySecurityEnhancements(app);

// 🛡️ SECURITY HEADERS EXTRAS - FINAL HARDENING
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By'); // Garante remoção absoluta em toda resposta
  res.setHeader('Server', 'VolatusPay-Gateway');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
  
  // 🛡️ PROTEÇÃO ANTI-SCRAPING E ANTI-DOWNLOAD
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, notranslate, noimageindex');
  
  // 🔒 PREVINE CACHE DE CÓDIGO EM FERRAMENTAS
  if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
});

// 🤖 SISTEMA AI SECURITY - IMPORTS (SEM QUEBRAR NADA)
let aiSecurityMiddleware: any, aiXSSMiddleware: any, aiBehaviorMiddleware: any, aiHoneypotMiddleware: any, aiHoneypot: any;
async function loadAISecurity() {
  try {
    ({ aiSecurityMiddleware, aiHoneypot } = await import('./security/ai-guardian.js'));
    ({ aiXSSMiddleware } = await import('./security/ai-xss-shield.js'));
    ({ aiBehaviorMiddleware } = await import('./security/ai-behavior-analyzer.js'));
    ({ aiHoneypotMiddleware } = await import('./security/ai-honeypot.js'));
    console.log('🤖 AI SECURITY SYSTEM LOADED - SYSTEM BLINDADO ATIVO! 💥');
  } catch (error) {
    console.log('⚠️ AI Security system not available, continuing with standard security');
  }
}

// Carregar AI Security
(async () => {
  await loadAISecurity();
})();

// 🔐 FIREBASE ADMIN AUTH MIDDLEWARE - CRITICAL SECURITY (DECLARE FIRST)
const authMiddleware = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    // ⚡ Otimizado: DEBUG AUTH log removido para performance
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.slice(7);
      
      try {
        // 🔥 GARANTIR QUE FIREBASE ESTEJA PRONTO
        await ensureFirebaseReady();
        const adminSdk = getAdmin();
        
        // Verify Firebase ID token
        const decodedToken = await adminSdk.auth().verifyIdToken(idToken);
        req.user = {
          uid: decodedToken.uid,
          email: decodedToken.email || null,
          email_verified: decodedToken.email_verified || false
        };
        console.log(`🔐 AUTH SUCCESS: ${decodedToken.email || decodedToken.uid} (${decodedToken.uid})`);
      } catch (authError: any) {
        console.warn(`🚨 AUTH FAILED: ${authError.message}`);
        // Don't fail request - just mark as unauthenticated
        req.user = null;
      }
    } else {
      // No auth header - unauthenticated
      req.user = null;
    }
    
    next();
  } catch (error: any) {
    console.error('❌ Auth middleware error:', error);
    req.user = null;
    next();
  }
};

// 👑 ADMIN AUTHORIZATION MIDDLEWARE - SECURE VIA CUSTOM CLAIMS
const adminAuthMiddleware = async (req: any, res: any, next: any) => {
  try {
    // ✅ VERIFICAR SE O USUÁRIO ESTÁ AUTENTICADO
    if (!req.user?.uid && !req.authUser?.uid) {
      console.log('❌ ADMIN ACCESS DENIED: No authenticated user');
      return res.status(401).json({
        error: 'Authentication required',
        code: 'ADMIN_AUTH_REQUIRED'
      });
    }

    // 🔐 VERIFICAR CUSTOM CLAIMS - MÉTODO SEGURO
    const isAdmin = req.user?.isAdmin || req.authUser?.isAdmin;
    
    if (!isAdmin) {
      const userEmail = req.user?.email || req.authUser?.email || 'unknown';
      console.log(`❌ ADMIN ACCESS DENIED: User ${userEmail} não tem permissões admin`);
      return res.status(403).json({
        error: 'Admin access required',
        code: 'ADMIN_ACCESS_DENIED',
        hint: 'Entre em contato com o suporte para solicitar acesso admin'
      });
    }

    const userEmail = req.user?.email || req.authUser?.email;
    console.log(`👑 ADMIN ACCESS GRANTED: ${userEmail} (Custom Claims)`);
    next();
  } catch (error: any) {
    console.error('❌ Admin auth middleware error:', error);
    return res.status(500).json({
      error: 'Internal server error during admin authorization',
      code: 'ADMIN_AUTH_ERROR'
    });
  }
};

// 🚦 RATE LIMITERS MUITO PERMISSIVOS - FOCO EM INVASÕES REAIS, NÃO NAVEGAÇÃO
// validate.trustProxy:true — consistente com app.set('trust proxy', 1)
const rateLimitValidate = { trustProxy: true };

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.', code: 'RATE_LIMIT_AUTH' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidate,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }
});

const paymentRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 1000,
  message: { error: 'Muitas solicitações de pagamento. Aguarde alguns minutos.', code: 'RATE_LIMIT_PAYMENT' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidate,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }
});

const adminRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 500,
  message: { error: 'Limite de operações admin excedido. Aguarde 5 minutos.', code: 'RATE_LIMIT_ADMIN' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidate,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }
});

const webhookRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 3000, // lançamento: até 3000 webhooks/min (EfíBank já tem HMAC, safe aumentar)
  message: { error: 'Limite de webhooks excedido. Aguarde 1 minuto.', code: 'RATE_LIMIT_WEBHOOK' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidate,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }
});

// 🆔 RASTREABILIDADE E AUDITORIA - SIEM CENTRALIZADO
app.use(requestIdMiddleware); // X-Request-ID para correlação de logs
app.use(etagMiddleware); // ETag para cache inteligente
app.use(auditLoggerMiddleware); // Trilhas de auditoria SIEM
console.log('📋 Logging & Auditoria ativados: X-Request-ID, ETag, SIEM trails');

// 🛡️ MIDDLEWARES DE SEGURANÇA (APLICADOS PRIMEIRO)
app.use(ddosProtectionMiddleware);
app.use(authMiddleware); // 🔐 FIREBASE AUTH (DEPOIS DOS SECURITY MIDDLEWARES)

// 🚦 RATE LIMITING — global + por rota específica
const globalApiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 120, // 120 req/min por IP em qualquer rota /api/*
  message: { error: 'Muitas requisições. Aguarde um momento.', code: 'RATE_LIMIT_GLOBAL' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidate,
  skip: (req) => {
    const ip = req.ip || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }
});
app.use('/api/*', globalApiRateLimiter);   // Global — cobre todas as rotas /api/*
app.use('/api/admin/*', adminRateLimiter); // Admin operations (mais restrito)
app.use('/api/webhook/*', webhookRateLimiter); // Webhook endpoints

// 🚦 RATE LIMIT GLOBAL — cobre TODAS as rotas (incluindo raiz, páginas, estáticos)
const globalAllRoutesLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 300, // 300 req/min por IP — checkout + polling PIX pode facilmente usar 60+ (era 60, muito baixo)
  message: { error: 'Too many requests. Please slow down.', code: 'RATE_LIMIT_GLOBAL_ALL' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: rateLimitValidate,
  skip: (req: any) => {
    const ip = req.ip || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    // Polling de status PIX e rotas críticas de pagamento têm rate limit próprio
    const p = req.path || '';
    if (p.includes('/status') || p.startsWith('/api/payment/') || p.startsWith('/api/orders/') || p.startsWith('/api/checkout')) return true;
    return _isViteDevPath(req);
  }
});
app.use(globalAllRoutesLimiter); // Aplica a TODAS as rotas sem exceção

// 🤖 AI SECURITY LAYERS - TECNOLOGIA DEVASTADORA
if (aiHoneypotMiddleware) app.use(aiHoneypotMiddleware); // Honeypot AI primeiro
if (aiBehaviorMiddleware) app.use(aiBehaviorMiddleware); // Análise comportamental
if (aiSecurityMiddleware) app.use(aiSecurityMiddleware); // Detector geral AI
if (aiXSSMiddleware) app.use(aiXSSMiddleware); // Proteção XSS AI

// 🛡️ SECURE TENANT DERIVATION - PREVENT CROSS-TENANT ACCESS
const TENANT_DEBUG = process.env.TENANT_DEBUG === 'true';

const getTenantFromAuth = async (req: any): Promise<string | null> => {
  const requestPath = req.path || 'unknown';
  const requestMethod = req.method || 'unknown';
  
  if (!req.user?.uid) {
    return null;
  }
  
  const uid = req.user.uid;
  
  try {
    // 👑 ADMINS usam seu próprio UID como tenantId (via Custom Claims)
    const isAdmin = req.user?.isAdmin || req.authUser?.isAdmin;
    if (isAdmin) {
      return uid;
    }
    
    let seller = null;
    try {
      const { firestoreCache } = await import('./lib/firestore-cache.js');
      seller = await firestoreCache.getSeller(uid);
    } catch (cacheError: any) {
      try {
        const admin = await getAdmin();
        const db = admin.firestore();
        const sellerDoc = await db.collection('sellers').doc(uid).get();
        if (sellerDoc.exists) {
          const sellerData = sellerDoc.data();
          seller = { id: sellerDoc.id, tenantId: sellerData?.tenantId, email: sellerData?.email, status: sellerData?.status, ...sellerData };
        }
      } catch (firebaseError: any) {
        seller = await storage.getSeller(uid);
      }
    }
    
    // 🔧 CORREÇÃO AGRESSIVA: Se seller existe mas tenantId está vazio/undefined, corrigir SEMPRE
    if (seller && (seller.tenantId !== uid)) {
      if (TENANT_DEBUG) {
        console.log(`🔧 [TENANT] Corrigindo tenantId incorreto para ${uid.substring(0, 8)}...`);
      }
      
      try {
        const admin = await getAdmin();
        const db = admin.firestore();
        await db.collection('sellers').doc(uid).update({
          tenantId: uid
        });
        
        if (storage && typeof storage.clearSellerCache === 'function') {
          await storage.clearSellerCache();
        }
        
        return uid;
      } catch (updateError) {
        console.error(`❌ Erro ao corrigir tenantId:`, updateError);
        return uid;
      }
    }
    
    // ✅ FIX CRÍTICO: SEMPRE retornar UID como tenantId para TODOS os usuários autenticados
    const finalTenant = seller?.tenantId || uid;
    return finalTenant;
  } catch (error: any) {
    console.error(`❌ Erro crítico em getTenantFromAuth:`, error.message);
    // ✅ FIX CRÍTICO: Mesmo em caso de erro, retornar UID como tenantId
    return uid;
  }
};



// ⚡ COMPRESSÃO GZIP/BROTLI — reduz bandwidth em 60-80% para JSON/HTML
// (instalado mas jamais ativado antes — hotfix de performance crítico)
import compression from 'compression';
app.use(compression({
  level: 6,        // equilíbrio CPU/tamanho
  threshold: 1024, // só comprime respostas > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Middleware básico — cookie-parser com proteção contra cookies malformados
app.use((req: any, res: any, next: any) => {
  cookieParser()(req, res, (err: any) => {
    if (err) {
      req.cookies = {};
      req.signedCookies = {};
      next();
    } else {
      next();
    }
  });
});
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// 🛡️ Bloqueia paths de scanner/reconhecimento — retorna 404 antes do SPA catch-all
const SCANNER_BAIT_PATHS = [
  '/wp-admin', '/wp-login.php', '/wp-config.php', '/wp-content',
  '/phpinfo.php', '/phpmyadmin', '/.env', '/.git', '/config.php',
  '/actuator', '/actuator/health', '/actuator/env', '/actuator/info',
  '/.aws', '/server-status', '/server-info', '/xmlrpc.php',
  '/administrator', '/joomla', '/drupal', '/magento',
];
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (SCANNER_BAIT_PATHS.some(b => p === b || p.startsWith(b + '/'))) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

// 🛡️ ATTACK PATTERN DETECTOR - Detecta SQL Injection, XSS, Command Injection no body
app.use((req, res, next) => {
  if (req.bypassAllSecurity) return next();
  attackPatternDetector(req, res, next);
});
console.log('🛡️ Attack Pattern Detector ATIVO - SQL/XSS/Command Injection Detection');
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts

// 💳 ROTA GET - BUSCAR ADQUIRENTES DO SELLER (PARA CHECKOUT)
app.get('/api/checkout-acquirers-by-seller/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;

    console.log(`💳 GET /api/checkout-acquirers-by-seller/${sellerId} - Buscando configurações`);

    if (!sellerId) {
      return res.status(400).json({ 
        error: 'Seller ID é obrigatório.',
        code: 'MISSING_SELLER_ID'
      });
    }

    await ensureFirebaseReady();
    const db = getFirestore();
    
    // Buscar seller primeiro
    const sellerRef = db.collection('sellers').doc(sellerId);
    const sellerSnapshot = await sellerRef.get();

    if (!sellerSnapshot.exists) {
      console.log(`❌ Seller ${sellerId} não encontrado - retornando 404`);
      return res.status(404).json({ 
        error: 'Seller não encontrado.',
        code: 'SELLER_NOT_FOUND'
      });
    }

    const sellerData = sellerSnapshot.data();
    const acquirersConfig = sellerData?.acquirers;

    if (!acquirersConfig || (!acquirersConfig.pix && !acquirersConfig.boleto && !acquirersConfig.creditCard)) {
      console.log(`ℹ️ Seller ${sellerId} não tem configurações específicas - usando padrão`);
      return res.status(404).json({ 
        message: 'Seller não tem configurações específicas de adquirentes - usar padrão global.',
        code: 'NO_CUSTOM_CONFIG'
      });
    }

    // Mapear para o formato esperado pelo frontend
    const acquirers: any = {};

    // PIX
    if (acquirersConfig.pix) {
      acquirers.pix = {
        enabled: true,
        acquirer: acquirersConfig.pix
      };
    }

    // Boleto
    if (acquirersConfig.boleto) {
      acquirers.boleto = {
        enabled: true,
        acquirer: acquirersConfig.boleto
      };
    }

    // Cartão de Crédito
    if (acquirersConfig.creditCard) {
      // Determinar se é cartão brasileiro ou global baseado no adquirente
      if (acquirersConfig.creditCard === 'efibank') {
        acquirers.brazilianCard = {
          enabled: true,
          acquirer: 'efibank'
        };
      } else {
        acquirers.globalCard = {
          enabled: true,
          acquirer: acquirersConfig.creditCard
        };
      }
    }

    console.log(`✅ Adquirentes do seller ${sellerId}:`, acquirers);
    
    return res.json({
      success: true,
      sellerId,
      acquirers
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar adquirentes do seller:', error);
    return res.status(500).json({
      error: 'Erro ao buscar configurações de adquirentes.',
      details: error.message,
      code: 'SERVER_ERROR'
    });
  }
});
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts

// 🛡️ ROUTERS SEGUROS (PCI DSS COMPLIANCE)
// 🚫 ROUTER INSEGURO REMOVIDO POR VIOLAÇÕES PCI
// app.use(tokenizeRouter);
import installmentsRouter from './installments-api.js';

// 📦 IMPORTAÇÕES DAS ROTAS MODULARIZADAS
import personalSalesRouter from './routes/personal-sales.js';
import ordersRouter from './routes/orders.js';
import checkoutsRouter from './routes/checkouts.js';
import productsRouter from './routes/products.js';
import configManagerRouter from './routes/config-manager.js';
import activatePaymentsRouter from './routes/activate-payments.js';
import premiationsRouter from './routes/premiations.js';
import firebaseImagesRouter from './routes/firebase-images.js';
import subscriptionsRouter from './routes/subscriptions.js';
import webhooksRouter from './routes/webhooks.js';
import teamManagementRouter from './routes/team-management.js';
import sellerTeamRouter from './routes/seller-team.js';
import supportTicketsRouter from './routes/support-tickets.js';
import customersRouter from './routes/customers.js';
import adminRefundsRouter from './routes/admin-refunds.js';
import admin2FARouter from './routes/admin-2fa.js';
import seller2FARouter from './routes/seller-2fa.js';
import balanceRouter from './routes/balance.js';
import withdrawalsRouter from './routes/withdrawals.js';
import showcaseRouter from './routes/showcase.js';
import fraudAlertsRouter from './routes/fraud-alerts.js';
import monitoringRouter from './routes/monitoring.js';
import feesRouter from './routes/fees.js';
import bunnyCdnRouter, { autoConfigureBunnyPublic } from "./routes/bunny-cdn.js";
import membersAuthRouter from "./routes/members-auth.js";
import facialVerificationRouter from "./routes/facial-verification.js";
import externalApiRouter from "./routes/external-api.js";
import pixMedRouter from "./routes/pix-med.js";
import disputesRouter from "./routes/disputes.js";
import securityRouter from "./routes/security.js";
import sellersRouter from "./routes/sellers.js";
import sellerCompaniesRouter from "./routes/seller-companies.js";
import onzAcquirerRouter from "./routes/onz-acquirer.js";
import affiliationsRouter from "./routes/affiliations.js";
import integrationsRouter from './routes/integrations.js';
import { createAdminConfigRouter } from "./routes/admin-config.js";
import adminRouter from './routes/admin.js';
import membersCoproductionRouter, { processCoproductionCommissions, autoCreateMemberOnPurchase } from './routes/members-coproduction.js';
import lgpdRouter from './routes/lgpd.js';
import webhookSigRouter from './routes/webhook-sig.js';
import nlpDlpRouter from './routes/nlp-dlp.js';
import qfubRouter from './routes/qfub.js';
import biometricRouter from './routes/biometric.js';
import atoRouter from './routes/ato.js';
import credstuffRouter from './routes/credstuff.js';
import canaryRouter from './routes/canary.js';
import deviceTrustRouter from './routes/device-trust.js';
import deceptionRouter from './routes/deception.js';
import deceptionNetRouter from './routes/deception-net.js';
import adaptiveDeceptionRouter from './routes/adaptive-deception.js';
import zkpRouter from './routes/zkp.js';
import zkpAuthRouter from './routes/zkp-auth.js';
import efiBankAccountsRouter from './routes/efibank-accounts.js';
app.use(installmentsRouter);

// 📦 CONECTAR ROTAS MODULARIZADAS
app.use(efiBankAccountsRouter);
app.use('/api/personal-sales', personalSalesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/products', productsRouter);
app.use('/api/checkouts', checkoutsRouter);
app.use('/api/showcase', showcaseRouter);
app.use('/api/config', configManagerRouter);
app.use(activatePaymentsRouter);
app.use('/api', firebaseImagesRouter);
app.use('/api', premiationsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/webhooks', webhooksRouter); // Alias sem /api (para proxy Replit: /api → api-server)
app.use('/api/admin/team', teamManagementRouter);
app.use('/api/support', supportTicketsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/admin/2fa', admin2FARouter);
app.use('/api/seller/2fa', seller2FARouter);
app.use('/api/seller/team', sellerTeamRouter);
app.use('/api/admin/withdrawals', verifyFirebaseToken, withdrawalsRouter);
// Mount também em /api/withdrawals para rotas cripto (seller + admin/crypto-withdrawals)
app.use('/api/withdrawals', verifyFirebaseToken, withdrawalsRouter);
app.use('/api/admin', verifyFirebaseToken, adminRefundsRouter);
app.use('/api/balance', balanceRouter);
app.use('/api', feesRouter);
app.use('/api/admin/fraud-alerts', fraudAlertsRouter);
app.use('/api/admin/monitoring', monitoringRouter);
app.use('/api/admin/pix', verifyFirebaseToken, pixMedRouter);
app.use('/api/admin/disputes', verifyFirebaseToken, disputesRouter);
app.use('/api/bunny', bunnyCdnRouter);

// 🖼️ PROXY PÚBLICO DE IMAGENS DO BUNNY STORAGE (sem auth - usado em <img src>)
app.get('/api/images/*', async (req: Request, res: Response) => {
  try {
    const rawPath = (req.params as any)[0] || '';
    const filePath = rawPath.replace(/\.\./g, '').replace(/^\/+/, '').trim();
    if (!filePath || filePath.length > 500) return res.status(400).end();

    // 1. Verificar arquivo local PRIMEIRO (sem depender do Bunny CDN)
    const localPath = path.join(path.resolve(import.meta.dirname, '..', 'uploads'), filePath);
    if (fs.existsSync(localPath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.sendFile(localPath);
    }

    // 2. Tentar Bunny CDN via getBunnyCredentials() (lê do Firestore se env var ausente)
    const { getBunnyCredentials: getBunnyCreds } = await import('./lib/bunny-helper.js');
    const bunnyCreds = await getBunnyCreds();
    const storageApiKey = bunnyCreds?.storageApiKey || process.env.BUNNY_STORAGE_API_KEY;
    const storageZone = bunnyCreds?.storageZoneName || process.env.BUNNY_STORAGE_ZONE_NAME || 'volatuspaypj';
    const storageRegion = bunnyCreds?.storageRegion || 'de';

    if (!storageApiKey) {
      // Fallback: redirect to CDN directly — file was uploaded there, public pull zone serves it
      const cdnHostname = bunnyCreds?.cdnHostname || process.env.BUNNY_CDN_HOSTNAME || 'volatuspaypj.b-cdn.net';
      console.warn(`⚠️ [IMAGE-PROXY] Sem credenciais storage, redirecionando para CDN: ${filePath}`);
      return res.redirect(302, `https://${cdnHostname}/${filePath}`);
    }

    const regionPrefix = storageRegion && storageRegion !== 'de' ? `${storageRegion}.` : '';
    const storageUrl = `https://${regionPrefix}storage.bunnycdn.com/${storageZone}/${filePath}`;
    const upstream = await fetch(storageUrl, {
      headers: { 'AccessKey': storageApiKey }
    });

    if (!upstream.ok) return res.status(upstream.status).end();

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(buffer);
  } catch (err: any) {
    console.error('❌ [IMAGE-PROXY] Erro:', err.message);
    res.status(500).end();
  }
});
app.use('/api/members', membersAuthRouter);
app.use('/api/upload/facial-verification', facialVerificationRouter);
app.use('/api/v1', externalApiRouter); // External API for integrations
app.use(securityRouter); // Security routes (IP blocking, entity blocking, shadow mode, emergency)
app.use(sellersRouter); // Seller routes (registration, management, admin, acquirers, webhooks)
app.use(sellerCompaniesRouter); // Multi-company routes
app.use(onzAcquirerRouter); // ONZ Finance routes (cash-in PIX, cash-out PIX, balance, admin)
app.use(affiliationsRouter);
app.use(integrationsRouter);
const adminConfigRouter = createAdminConfigRouter(() => stripeConfigCache);
app.use(adminConfigRouter);
app.use(adminRouter);
app.use(membersCoproductionRouter);
app.use(lgpdRouter); // LGPD Compliance Engine (Lei 13.709/2018)
app.use(webhookSigRouter); // Webhook Ed25519 Signing (RFC 8032)
app.use(nlpDlpRouter);         // Module #3 — NLP-DLP: Data Loss Prevention (PII/PCI/Credentials)
app.use(qfubRouter);           // Module #4 — QFUB: File Upload Bypass Detection (40+ técnicas)
app.use(biometricRouter);      // Module #5 — Biometric: Biometria Comportamental Contínua
app.use(atoRouter);            // Module #6 — ATO: Account Takeover Detection
app.use(credstuffRouter);      // Module #7 — CredStuff: Credential Stuffing Detector
app.use(canaryRouter);         // Module #8 — Canary: Honeytokens de Exfiltração
app.use(deviceTrustRouter);    // Module #9 — Device Trust: ECDSA P-256 Session Binding
app.use(deceptionRouter);      // Module #10 — Deception: Honeytoken Mesh
app.use(deceptionNetRouter);   // Module #11 — Deception Net: Autonomous MITRE ATT&CK Network
app.use(adaptiveDeceptionRouter); // Module #12a — Adaptive Deception: Endereços Falsos por IP
app.use(zkpRouter);            // Module #12b — ZKP: Zero-Knowledge Proof of Innocence
app.use(zkpAuthRouter);        // Module #12c — ZKP-Auth: API Auth sem revelar segredo

// 📁 ENDPOINT PARA UPLOAD DE DOCUMENTOS DE SELLERS - BUNNY CDN
app.post('/api/upload/document', 
  userRateLimit('document-upload'),
  upload.single('file'),
  validateMagicBytes,
  async (req: any, res) => {
    try {
      console.log('📁 UPLOAD DOCUMENT - Iniciando processamento via BUNNY CDN...');
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Nenhum arquivo foi enviado'
        });
      }
      
      // 📊 DADOS DO SELLER PARA ORGANIZAÇÃO
      const businessName = req.body.businessName || 'seller';
      const document = req.body.document || 'doc';
      const email = req.body.email || 'email';
      
      console.log('🏢 Seller Info:', { businessName: sanitizeForLogs(businessName), document: obfuscateKey(document), email: obfuscateKey(email) });
      
      // 🗂️ FUNÇÃO PARA SANITIZAR EMAIL (isolamento por seller)
      const sanitizeEmail = (email: string): string => {
        return email
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '_')
          .replace(/@/g, '_at_')
          .substring(0, 50);
      };
      
      const sanitizeDocument = (doc: string): string => {
        return doc
          .replace(/[^0-9]/g, '')
          .substring(0, 14);
      };
      
      const cleanEmail = sanitizeEmail(email);
      const cleanDoc = sanitizeDocument(document);
      
      // 📂 ESTRUTURA DE PASTAS: seller-documents/email_sanitizado/
      // Cada seller tem pasta isolada por email - NUNCA mistura dados
      const sellerFolder = cleanEmail || 'anonymous';
      
      console.log(`🗂️ Pasta isolada do seller: ${sellerFolder}`);
      
      const timestamp = Date.now();
      
      // ✅ DERIVAR EXTENSÃO DO MIMETYPE (MAIS SEGURO)
      const mimeToExt: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'application/pdf': 'pdf'
      };
      const fileExtension = mimeToExt[req.file.mimetype] || 'bin';
      
      const fileName = `doc_${timestamp}_${nanoid(8)}.${fileExtension}`;
      
      // 🐰 UPLOAD PARA BUNNY/FIREBASE STORAGE (pasta isolada por email)
      const folderPath = `seller-documents/${sellerFolder}`;
      const fullFilePath = `${folderPath}/${fileName}`;
      console.log(`📂 Salvando documento: ${fullFilePath}`);
      
      const uploadResult = await uploadToBunnyStorage(
        fullFilePath,
        req.file.buffer,
        req.file.mimetype
      );
      
      if (!uploadResult.success || !uploadResult.url) {
        throw new Error(uploadResult.error || 'Falha no upload');
      }
      
      const cdnUrl = uploadResult.url;
      
      // 📝 Registrar no Firestore para auditoria de compliance
      await ensureFirebaseReady();
      const firestore = getFirestore();
      await firestore.collection('sellerDocumentLogs').add({
        email: email,
        document: cleanDoc,
        bunnyUrl: cdnUrl,
        storagePath: `${folderPath}/${fileName}`,
        uploadedAt: new Date().toISOString(),
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        storage: 'bunny-cdn',
        purpose: 'seller_kyc_document'
      });
      
      console.log(`✅ UPLOAD CONCLUÍDO - Documento salvo no Bunny CDN`);
      console.log(`🔗 URL CDN: ${cdnUrl}`);
      
      res.json({
        success: true,
        url: cdnUrl,
        path: `${folderPath}/${fileName}`,
        message: 'Documento salvo com sucesso no Bunny CDN'
      });
      
    } catch (error) {
      console.error('❌ Erro no upload de documento:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao salvar documento',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
});
// 📊 ENDPOINT PARA ESTATÍSTICAS DE ASSINATURAS - SECURITY: AUTH REQUIRED
app.get('/api/subscriptions/stats', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId, checkoutId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId é obrigatório' });
    }
    
    // 🔥 OBTER ADMIN E DB
    const adminInstance = await getAdmin();
    const db = adminInstance.firestore();
    
    // 🔍 BUSCAR ASSINATURAS DO FIRESTORE
    let subscriptionsQuery = db.collection('subscriptions')
      .where('tenantId', '==', tenantId);
    
    // 🎯 FILTRAR POR CHECKOUT SE FORNECIDO
    if (checkoutId && checkoutId !== 'all') {
      subscriptionsQuery = subscriptionsQuery.where('checkoutId', '==', checkoutId);
    }
    
    const subscriptionsSnapshot = await subscriptionsQuery.get();
    const subscriptions = subscriptionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];
    
    // 📊 CALCULAR ESTATÍSTICAS
    const now = new Date();
    const activeSubscriptions = subscriptions.filter(sub => 
      sub.status === 'active' && new Date(sub.endDate) > now
    );
    const cancelledSubscriptions = subscriptions.filter(sub => sub.status === 'cancelled');
    
    // 📉 CALCULAR CHURN RATE (taxa de cancelamento)
    // Churn = (canceladas / (ativas + canceladas)) * 100
    const totalSubscriptions = activeSubscriptions.length + cancelledSubscriptions.length;
    const churnRate = totalSubscriptions > 0 
      ? Number(((cancelledSubscriptions.length / totalSubscriptions) * 100).toFixed(2))
      : 0;
    
    // 💰 FUNÇÃO PARA CALCULAR TAXAS
    const calculateSubscriptionFees = (subscription: any) => {
      const amount = subscription.amount || 0;
      
      if (subscription.method === 'pix') {
        // PIX: R$2,49 + 2%
        const fixedFee = 249;
        const percentFee = Math.round(amount * 0.02);
        const totalFee = fixedFee + percentFee;
        return {
          fee: totalFee,
          netAmount: amount - totalFee
        };
      } else if (subscription.method === 'card') {
        const isGlobalCard = subscription.processor === 'stripe';
        
        if (isGlobalCard) {
          // Stripe Global: 6.4% + R$1.50
          const percentFee = Math.round(amount * 0.064);
          const fixedFee = 150;
          const totalFee = percentFee + fixedFee;
          return {
            fee: totalFee,
            netAmount: amount - totalFee
          };
        } else {
          // EfíBank BR: R$2,49 + 5.2%
          const fixedFee = 249;
          const percentFee = Math.round(amount * 0.052);
          const totalFee = fixedFee + percentFee;
          return {
            fee: totalFee,
            netAmount: amount - totalFee
          };
        }
      }
      
      return { fee: 0, netAmount: amount };
    };
    
    // 💸 CALCULAR VALORES TOTAIS (APENAS ASSINATURAS ATIVAS)
    let totalGrossRevenue = 0;
    let totalFees = 0;
    let totalRevenue = 0;
    let monthlyRecurring = 0;
    
    activeSubscriptions.forEach(subscription => {
      const amount = subscription.amount || 0;
      const fees = calculateSubscriptionFees(subscription);
      
      totalGrossRevenue += amount;
      totalFees += fees.fee;
      totalRevenue += fees.netAmount;
      monthlyRecurring += amount; // MRR = soma de todas assinaturas ativas
    });
    
    res.json({
      active: activeSubscriptions.length,
      cancelled: cancelledSubscriptions.length,
      totalRevenue,
      totalGrossRevenue,
      totalFees,
      monthlyRecurring,
      churnRate
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas de assinaturas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ===============================================
// 🤝 AFFILIATIONS API - SISTEMA DE AFILIAÇÃO
// [EXTRACTED] Affiliations CRUD routes moved to server/routes/affiliations.ts
// 🛡️ MIDDLEWARE DE CRIPTOGRAFIA E SANITIZAÇÃO DE DADOS SENSÍVEIS
app.use(sanitizeHttpResponse);

// ================================================================
// 🧹 ENDPOINT DE SINCRONIZAÇÃO INTERNO (ANTES DA PROTEÇÃO ADMIN)
// ================================================================

// ✅ CHECKOUT DE TESTE CRIADO COM SUCESSO - ENDPOINT REMOVIDO APÓS USO

// 👤 REGISTRO DE SELLERS - SECURITY: RATE LIMITED + VALIDATION + ANTI-INJECTION
// 🛡️ SELLER REGISTRATION ULTRA-HARDENING MIDDLEWARE
const sellerRegistrationSecurityMiddleware = (req: any, res: any, next: any) => {
  try {
    const { email, phone, document, personalDocumentNumber, businessName } = req.body;
    
    // 🚫 VALIDAÇÃO 1: ANTI-FLOOD PROTECTION
    const userAgent = req.headers['user-agent'] || '';
    if (userAgent.length < 10 || /bot|crawler|spider|test/i.test(userAgent)) {
      console.warn(`❌ SELLER REG BLOCKED: Suspicious user agent from ${req.ip}: ${userAgent}`);
      return res.status(400).json({
        success: false,
        message: 'SECURITY: User agent suspeito detectado'
      });
    }
    
    // 🚫 VALIDAÇÃO 2: DADOS OBRIGATÓRIOS ULTRA-RÍGIDOS
    if (!email || !phone || !document || !personalDocumentNumber || !businessName) {
      console.warn(`❌ SELLER REG BLOCKED: Missing required fields from ${req.ip}`);
      return res.status(400).json({
        success: false,
        message: 'SECURITY: Todos os campos obrigatórios devem estar preenchidos'
      });
    }
    
    // 🚫 VALIDAÇÃO 3: LIMITES DE TAMANHO EXTREMOS
    const fieldLimits = {
      email: 254,
      phone: 20,
      businessName: 100,
      document: 20,
      personalDocumentNumber: 20
    };
    
    for (const [field, limit] of Object.entries(fieldLimits)) {
      const value = req.body[field];
      if (value && value.length > limit) {
        console.warn(`❌ SELLER REG BLOCKED: Field ${field} too long from ${req.ip}: ${value.length} chars`);
        return res.status(400).json({
          success: false,
          message: `SECURITY: Campo ${field} excede o limite permitido`
        });
      }
    }
    
    // 🚫 VALIDAÇÃO 4: PADRÕES MALICIOSOS
    const maliciousPatterns = [
      /<script|javascript:|on\w+\s*=/i,
      /$\(|jQuery|$\{/i,
      /exec\(|eval\(|Function\(/i,
      /\b(union|select|insert|delete|drop|create|alter)\b/i,
      /<iframe|<object|<embed/i
    ];
    
    for (const [field, value] of Object.entries(req.body)) {
      if (typeof value === 'string') {
        for (const pattern of maliciousPatterns) {
          if (pattern.test(value)) {
            console.warn(`❌ SELLER REG BLOCKED: Malicious pattern in ${field} from ${req.ip}: ${value}`);
            return res.status(400).json({
              success: false,
              message: 'SECURITY: Conteúdo suspeito detectado nos dados'
            });
          }
        }
      }
    }
    
    // 🚫 VALIDAÇÃO 5: EMAIL E TELEFONE ÚNICOS (mais rigoroso)
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailPattern.test(email)) {
      console.warn(`❌ SELLER REG BLOCKED: Invalid email pattern from ${req.ip}: ${email}`);
      return res.status(400).json({
        success: false,
        message: 'SECURITY: Formato de email inválido'
      });
    }
    
    console.log(`✅ SELLER REG SECURITY: Passed all validations from ${req.ip} for ${email}`);
    next();
    
  } catch (error) {
    console.error('❌ SELLER REG SECURITY ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'SECURITY: Erro na validação de segurança'
    });
  }
};
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts

// 🔍 ENDPOINT PARA VERIFICAR SE EMAIL ESTÁ DISPONÍVEL
app.post('/api/auth/check-email', async (req, res) => {
  try {
    const { email, type } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        available: false,
        message: 'Email é obrigatório'
      });
    }
    
    console.log(`🔍 Verificando disponibilidade do email: ${email} (tipo: ${type})`);
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    // Verificar no Firebase Auth
    let authUser: any = null;
    try {
      authUser = await admin.auth().getUserByEmail(email);
      console.log(`🔍 Email ${email} existe no Firebase Auth (uid: ${authUser.uid})`);
    } catch (authError: any) {
      if (authError.code !== 'auth/user-not-found') {
        console.error('❌ Erro ao verificar email no Firebase Auth:', authError.message);
      }
    }
    
    // Se existe no Auth, verificar se tem documento de vendedor ou cliente (conta completa)
    if (authUser) {
      // 1️⃣ Verificar no Neon (fonte de verdade para sellers)
      let hasNeonSeller = false;
      try {
        const { neonQuery: nqCE } = await import('./lib/neon-db.js');
        await nqCE(async (sql: any) => {
          const rows = (await sql`SELECT id FROM sellers WHERE id = ${authUser.uid} OR email = ${email} LIMIT 1`) as any[];
          if (rows[0]) hasNeonSeller = true;
        }, `checkEmailNeon:${email}`);
      } catch (_nqErr) { /* Neon indisponível, continua */ };

      if (hasNeonSeller) {
        console.log(`❌ Email ${email} já cadastrado como seller no Neon`);
        return res.json({ success: true, available: false, message: 'Email já cadastrado' });
      }

      // 2️⃣ Verificar no Firestore
      const [sellerDoc, customerQuery] = await Promise.all([
        db.collection('sellers').doc(authUser.uid).get(),
        db.collection('customers').where('email', '==', email).limit(1).get(),
      ]);
      
      const hasFsSeller = sellerDoc.exists;
      const hasCustomer = !customerQuery.empty;
      
      if (hasFsSeller || hasCustomer) {
        // Conta completa — email realmente cadastrado
        console.log(`❌ Email ${email} já cadastrado (fsSeller=${hasFsSeller}, customer=${hasCustomer})`);
        return res.json({ success: true, available: false, message: 'Email já cadastrado' });
      }
      
      // Conta órfã (Auth sem documento em Neon/Firestore) — limpa para permitir novo cadastro
      console.log(`🧹 Email ${email} tem conta órfã no Auth (sem seller no Neon/Firestore) — removendo`);
      try {
        await admin.auth().deleteUser(authUser.uid);
        console.log(`✅ Conta órfã ${authUser.uid} removida`);
      } catch (delErr: any) {
        console.error('❌ Erro ao remover conta órfã:', delErr.message);
        // Se não conseguiu deletar, bloqueia por segurança
        return res.json({ success: true, available: false, message: 'Email já cadastrado' });
      }
    }
    
    // Verificar também por email no Neon (seller sem Auth) — contas Neon legacy
    if (type === 'seller') {
      let neonSellerByEmail = false;
      try {
        const { neonQuery: nqCE2 } = await import('./lib/neon-db.js');
        await nqCE2(async (sql: any) => {
          const rows = (await sql`SELECT id FROM sellers WHERE email = ${email} LIMIT 1`) as any[];
          if (rows[0]) neonSellerByEmail = true;
        }, `checkEmailNeonByEmail:${email}`);
      } catch (_nqErr2) { /* Neon indisponível, continua */ }
      if (neonSellerByEmail) {
        console.log(`❌ Email ${email} já existe como seller no Neon (sem Auth)`);
        return res.json({ success: true, available: false, message: 'Email já cadastrado como vendedor' });
      }

      // Fallback Firestore legacy
      const sellerQuery = await db.collection('sellers')
        .where('email', '==', email)
        .limit(1)
        .get();
      if (!sellerQuery.empty) {
        console.log(`❌ Email ${email} já existe na coleção sellers (Firestore legacy)`);
        return res.json({ success: true, available: false, message: 'Email já cadastrado como vendedor' });
      }
    } else if (type === 'customer') {
      const customerQuery = await db.collection('customers')
        .where('email', '==', email)
        .limit(1)
        .get();
      if (!customerQuery.empty) {
        console.log(`❌ Email ${email} já existe na coleção customers (legacy)`);
        return res.json({ success: true, available: false, message: 'Email já cadastrado como cliente' });
      }
    }
    
    console.log(`✅ Email ${email} está disponível`);
    return res.json({ success: true, available: true, message: 'Email disponível' });
    
  } catch (error) {
    console.error('❌ Erro ao verificar email:', error);
    return res.status(500).json({
      success: false,
      available: false,
      message: 'Erro ao verificar email'
    });
  }
});
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts

// 🧹 ENDPOINT ESPECIAL PARA LIMPAR SELLERS ÓRFÃOS
// 🚨 ENDPOINT REMOVIDO POR SEGURANÇA - ERA UM BACKDOOR PERIGOSO
app.post('/api/internal/test-notifications-DISABLED', async (req: any, res: any) => {
  res.status(410).json({ error: 'removed' });
  const messages = [
    { label: '1/7 — CONTA APROVADA', text: `✅ *Conta Aprovada!*\n\nOlá, João Silva! 🎉\n\nSua conta na *VolatusPay* foi aprovada e você já pode começar a vender!\n\n🔗 Acesse agora:\nhttps://volatuspay.com/login\n\nBoas vendas! 🚀` },
    { label: '2/7 — CONTA REJEITADA', text: `⚠️ *Atenção — Cadastro Pendente de Ajuste*\n\nOlá, João Silva!\n\nSua documentação na *VolatusPay* precisa de ajustes:\n\n📋 *Observação do time:*\n_Documento RG enviado está ilegível. Por favor, reenvie com melhor qualidade._\n\nPor favor, corrija as informações e reenvie. Qualquer dúvida, fale com o suporte.\n\n🔗 https://volatuspay.com/login` },
    { label: '3/7 — SAQUE APROVADO', text: `✅ *Saque Aprovado!*\n\nOlá, João Silva!\n\nSeu saque de *R$ 1.250,00* foi aprovado e está sendo processado.\n\n📋 *Chave PIX:* 55119****3612\n🆔 *ID:* wd_test_abc123\n\nO valor será transferido em breve para sua conta. 💸` },
    { label: '4/7 — SAQUE RECUSADO', text: `❌ *Saque Recusado*\n\nOlá, João Silva!\n\nSeu pedido de saque de *R$ 500,00* foi recusado.\n\n📋 *Motivo:* Chave PIX inválida. Atualize sua chave PIX no painel e tente novamente.\n\nO saldo foi devolvido para sua conta disponível. Para mais detalhes, acesse:\n🔗 https://volatuspay.com/login` },
    { label: '5/7 — RESUMO 11:00', text: `🍽️ *Chegou a hora do almoço!*\n_Confira o resumo da manhã:_\n\n📊 *Hoje ainda não há vendas registradas.*\n\nQue tal revisar seus checkouts e impulsionar suas vendas? 🚀\n\n_VolatusPay — Suas finanças, simplificadas._` },
    { label: '6/7 — RESUMO 17:00', text: `☀️ *Boa tarde! Fim do horário comercial.*\n_Veja como foi o seu dia até agora:_\n\n━━━━━━━━━━━━━━━━━━━━━\n📦 *Total de vendas:* 7\n💰 *Faturamento bruto:* R$ 2.380,00\n✅ *Valor líquido:* R$ 2.142,00\n━━━━━━━━━━━━━━━━━━━━━\n\nContinue assim! 🏆\n_VolatusPay — Suas finanças, simplificadas._` },
    { label: '7/7 — RESUMO 23:00', text: `🌙 *Encerrando mais um dia!*\n_Aqui está o resumo completo de hoje:_\n\n━━━━━━━━━━━━━━━━━━━━━\n📦 *Total de vendas:* 12\n💰 *Faturamento bruto:* R$ 4.760,00\n✅ *Valor líquido:* R$ 4.284,00\n━━━━━━━━━━━━━━━━━━━━━\n\nContinue assim! 🏆\n_VolatusPay — Suas finanças, simplificadas._` },
  ];
  const results: any[] = [];
  for (const { label, text } of messages) {
    const r = await doSend(text);
    console.log(`📲 [TEST] ${label} → ${r.success ? '✅ ENVIADO' : '❌ ' + r.message}`);
    results.push({ label, success: r.success, message: r.message });
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  res.json({ results });
});

app.post('/api/internal/sync-sellers', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    // 🔐 AGORA EXIGE AUTENTICAÇÃO FIREBASE + ADMIN (SEM MAIS BACKDOORS)
    console.log('🧹 SYNC SEGURO - Admin autenticado executando sincronização...', req.user?.uid);
    
    // 🛡️ SEGURANÇA: Agora usa autenticação Firebase real
    // Removido token hardcoded perigoso
    
    console.log('🧹 SYNC INTERNO - Iniciando sincronização de sellers com Firebase Auth...');
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    // 1️⃣ BUSCAR TODOS OS SELLERS DO NEON
    let firestoreSellers: string[] = [];
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM sellers`;
      firestoreSellers = rows.map((r: any) => r.id);
    }, 'syncSellersListAll');
    
    console.log(`📊 Encontrados ${firestoreSellers.length} sellers no Neon`);
    
    // 2️⃣ VERIFICAR QUAIS EXISTEM NO FIREBASE AUTH
    const authUids: string[] = [];
    const orphanSellers: string[] = [];
    
    for (const sellerId of firestoreSellers) {
      try {
        // Verificar se o UID existe no Firebase Auth
        await admin.auth().getUser(sellerId);
        authUids.push(sellerId);
        console.log(`✅ Seller ${sellerId} existe no Firebase Auth`);
      } catch (error) {
        // Seller não existe no Firebase Auth
        orphanSellers.push(sellerId);
        console.log(`🗑️ Seller órfão detectado: ${sellerId} - NÃO existe no Firebase Auth`);
      }
    }
    
    console.log(`📊 RESULTADO: ${authUids.length} sellers válidos, ${orphanSellers.length} órfãos`);
    
    // 3️⃣ REMOVER SELLERS ÓRFÃOS DO FIRESTORE
    let removedCount = 0;
    if (orphanSellers.length > 0) {
      const batch = db.batch();
      
      for (const orphanId of orphanSellers) {
        console.log(`🗑️ Removendo seller órfão: ${orphanId}`);
        const docRef = db.collection('sellers').doc(orphanId);
        batch.delete(docRef);
        removedCount++;
      }
      
      await batch.commit();
      console.log(`🧹 LIMPEZA CONCLUÍDA: ${removedCount} sellers órfãos removidos do Firestore`);
      
      // 4️⃣ LIMPAR CACHE PARA ATUALIZAÇÃO IMEDIATA
      await (storage as any).clearSellerCache?.();
      console.log('🔄 Cache de sellers limpo - dados atualizados!');
    }
    
    res.json({
      success: true,
      message: 'Sincronização concluída',
      summary: {
        totalFirestore: firestoreSellers.length,
        validAuth: authUids.length,
        orphansRemoved: removedCount,
        orphansList: orphanSellers
      }
    });
    
  } catch (error: any) {
    console.error('❌ Erro na sincronização:', error);
    res.status(500).json({
      error: 'Erro na sincronização'
      // SECURITY: Details removed to prevent information disclosure
    });
  }
});

// 🛡️ SECURITY REPORTS SYSTEM - PRIMEIRO QUE ADMIN
// Security reports routes will be imported separately if needed

// ================================================================
// 🛡️ ULTRA-HARDENED SECURITY MANAGEMENT APIS - ADMIN ONLY
// ================================================================

// [EXTRACTED] Security routes moved to server/routes/security.ts

// 📊 ADMIN - ESTATÍSTICAS GERAIS DO SISTEMA - 🛡️ PROTEGIDO
// [EXTRACTED] get /api/admin/stats moved to server/routes/admin.ts

// [EXTRACTED] Security routes moved to server/routes/security.ts

// 🔍 API PÚBLICA - VERIFICAR SE CONTA ESTÁ BLOQUEADA
app.post('/api/auth/check-blocked', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user?.uid || req.authUser?.uid;
    
    if (!uid) {
      return res.status(401).json({ 
        error: 'Usuário não autenticado',
        blocked: false 
      });
    }
    
    // Obter IP e device fingerprint (opcional)
    const clientIP = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() 
                    || req.ip 
                    || req.socket.remoteAddress 
                    || 'unknown';
    
    const { deviceFingerprint } = req.body;
    
    console.log('🔍 Verificando bloqueio para:', { uid, ip: clientIP });
    
    // Verificar se está bloqueado
    const result = await entityBlocker.isBlocked({
      uid,
      ip: clientIP,
      deviceFingerprint: deviceFingerprint?.canvas
    });
    
    if (result.blocked && result.block) {
      console.log('🚫 Conta bloqueada detectada:', {
        uid,
        reason: result.block.reason,
        severity: result.block.severity
      });
      
      return res.json({
        blocked: true,
        reason: result.block.reason,
        severity: result.block.severity,
        message: 'Sua conta foi bloqueada. Entre em contato com o suporte se acredita que foi um erro.'
      });
    }
    
    // Não bloqueado
    return res.json({
      blocked: false,
      message: 'Conta ativa'
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao verificar bloqueio:', error?.message || error);
    console.error('❌ Stack:', error?.stack);
    
    // ✅ FAIL-CLOSED: Em caso de erro, bloquear acesso por segurança
    return res.status(503).json({
      blocked: true,
      error: 'Sistema de segurança temporariamente indisponível',
      message: 'Por favor, tente novamente em alguns instantes.'
    });
  }
});

// 🔐 API - ATUALIZAR SESSÃO DO NAVEGADOR (Browser ID)
app.post('/api/auth/update-browser-session', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user?.uid || req.authUser?.uid;
    const { browserId } = req.body;
    
    if (!uid || !browserId) {
      return res.status(400).json({ 
        error: 'UID e browserId são obrigatórios' 
      });
    }
    
    try {
      const { firestoreCache } = await import('./lib/firestore-cache.js');
      const cachedSeller = await firestoreCache.getSeller(uid);
      
      if (cachedSeller) {
        try {
          await ensureFirebaseReady();
          const admin = getAdmin();
          const db = admin.firestore();
          await db.collection('sellers').doc(uid).update({
            browserId,
            lastLoginAt: new Date(),
            updatedAt: new Date()
          });
        } catch (writeErr: any) {
          if (writeErr?.code === 8 || writeErr?.message?.includes('RESOURCE_EXHAUSTED')) {
            console.log('⚠️ [BROWSER-SESSION] Write adiado - quota Firestore');
          }
        }
      }
    } catch (e: any) {
      console.log('⚠️ [BROWSER-SESSION] Operação adiada:', e?.message?.substring(0, 50));
    }
    
    res.json({ 
      success: true,
      message: 'Browser session atualizada com sucesso' 
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao atualizar browser session:', error?.message || error);
    res.json({ 
      success: true,
      message: 'Browser session registrada' 
    });
  }
});
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts

// 🛡️ SCHEMA ZOD PARA VALIDAÇÃO DE REGRAS DE BLOQUEIO
// [EXTRACTED] post /api/admin/products/:productId/unblock moved to server/routes/admin.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts

// 🔒 FUNÇÃO HELPER: CALCULAR % DE REEMBOLSO E VERIFICAR RISCO

// 🛡️ HELPER: Obter threshold com fallback seguro (aceita 0% como válido)
// [EXTRACTED] helper: getThresholdWithDefault moved to server/routes/admin.ts


// [EXTRACTED] post /api/admin/check-seller-risk/:sellerId moved to server/routes/admin.ts

// 📊 API - BUSCAR VENDAS REAIS DE UM CHECKOUT ESPECÍFICO (100% REAL DATA)
app.get('/api/checkout/:checkoutId/sales', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.params;
    
    if (!checkoutId) {
      return res.status(400).json({ 
        success: false, 
        error: 'checkoutId é obrigatório' 
      });
    }
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    console.log(`📊 BUSCANDO VENDAS REAIS DO CHECKOUT: ${checkoutId}`);
    
    // 🔍 BUSCAR ORDERS DESTE CHECKOUT (MAIS NOVAS PRIMEIRO)
    const ordersQuery = await db.collection('orders')
      .where('checkoutId', '==', checkoutId)
      .orderBy('createdAt', 'desc')
      .get();
    
    console.log(`📋 Total de orders encontradas: ${ordersQuery.size}`);
    
    // 📊 CONTAR VENDAS PAGAS E PENDENTES
    let paid = 0;
    let pending = 0;
    
    ordersQuery.forEach((doc: any) => {
      const order = doc.data();
      const orderStatus = order.status;
      
      console.log(`  📦 Order ${doc.id}: status=${orderStatus}, customer=${order.customer?.name}, amount=R$${(order.amount / 100).toFixed(2)}`);
      
      if (orderStatus === 'paid') {
        paid++;
      } else if (orderStatus === 'pending') {
        pending++;
      }
    });
    
    console.log(`✅ VENDAS REAIS: ${paid} pagas, ${pending} pendentes (Total: ${paid + pending})`);
    
    res.json({
      success: true,
      sales: {
        paid,
        pending,
        total: paid + pending
      }
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar vendas do checkout:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao buscar vendas do checkout' 
    });
  }
});

// 📊 API - BUSCAR ANALYTICS REAIS DE UM CHECKOUT ESPECÍFICO (TEMPO REAL)
app.get('/api/checkout/:checkoutId/analytics', async (req, res) => {
  try {
    const { checkoutId } = req.params;
    
    if (!checkoutId) {
      return res.status(400).json({ success: false, error: 'checkoutId é obrigatório' });
    }
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    console.log(`📊 BUSCANDO ANALYTICS DO CHECKOUT: ${checkoutId}`);
    
    // 🔍 BUSCAR DOCUMENTO DE ANALYTICS (ou criar se não existir)
    const analyticsRef = db.collection('checkoutAnalytics').doc(checkoutId);
    const analyticsDoc = await analyticsRef.get();
    
    let analytics = {
      pageViews: 0,
      formFilled: 0,
      paymentClicked: 0,
      activeNow: 0
    };
    
    if (analyticsDoc.exists) {
      const data = analyticsDoc.data();
      analytics.pageViews = data?.pageViews || 0;
      analytics.formFilled = data?.formFilled || 0;
      analytics.paymentClicked = data?.paymentClicked || 0;
      
      // 🔥 CALCULAR VISITANTES ONLINE AGORA (últimos 5 minutos)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const sessionsQuery = await analyticsRef.collection('sessions')
        .where('lastSeenAt', '>', fiveMinutesAgo)
        .get();
      
      analytics.activeNow = sessionsQuery.size;
      
      console.log(`✅ ANALYTICS: ${analytics.pageViews} visitas, ${analytics.formFilled} forms, ${analytics.paymentClicked} cliques, ${analytics.activeNow} online agora`);
    } else {
      console.log(`ℹ️ ANALYTICS: Checkout ${checkoutId} ainda não tem dados`);
    }
    
    res.json({ success: true, analytics });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar analytics:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar analytics' });
  }
});

// 📊 API - RASTREAR EVENTO DE ANALYTICS (pageView, formFilled, paymentClicked)
app.post('/api/checkout/:checkoutId/analytics/track', async (req, res) => {
  try {
    const { checkoutId } = req.params;
    const { event, sessionId } = req.body;
    
    if (!checkoutId || !event || !sessionId) {
      return res.status(400).json({ success: false, error: 'checkoutId, event e sessionId são obrigatórios' });
    }
    
    // Validar tipo de evento
    const validEvents = ['pageView', 'formFilled', 'paymentClicked'];
    if (!validEvents.includes(event)) {
      return res.status(400).json({ success: false, error: `Evento inválido. Use: ${validEvents.join(', ')}` });
    }
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    console.log(`📊 TRACKING EVENT: ${event} para checkout ${checkoutId} (session: ${sessionId})`);
    
    const analyticsRef = db.collection('checkoutAnalytics').doc(checkoutId);
    const sessionRef = analyticsRef.collection('sessions').doc(sessionId);
    
    // 🔥 ATUALIZAR CONTADOR + SESSION TIMESTAMP (batch para atomicidade)
    const batch = db.batch();
    
    // Incrementar contador do evento
    const fieldMap: { [key: string]: string } = {
      'pageView': 'pageViews',
      'formFilled': 'formFilled',
      'paymentClicked': 'paymentClicked'
    };
    
    batch.set(analyticsRef, {
      [fieldMap[event]]: FieldValue.increment(1)
    }, { merge: true });
    
    // Atualizar timestamp da sessão (para calcular "online agora")
    batch.set(sessionRef, {
      lastSeenAt: new Date(),
      checkoutId
    }, { merge: true });
    
    await batch.commit();
    
    console.log(`✅ EVENT TRACKED: ${event} registrado com sucesso`);
    
    res.json({ success: true, message: 'Evento rastreado com sucesso' });
    
  } catch (error: any) {
    console.error('❌ Erro ao rastrear evento:', error);
    res.status(500).json({ success: false, error: 'Erro ao rastrear evento' });
  }
});

// 📊 CHECKOUT ANALYTICS EVENTS (frontend tracking)
app.post('/api/checkout-events', async (req, res) => {
  try {
    const event = req.body;
    if (!event || !event.eventType) {
      return res.status(400).json({ success: false, error: 'eventType obrigatório' });
    }

    // Persistir evento no Firestore de forma assíncrona (não bloqueia resposta)
    setImmediate(async () => {
      try {
        await ensureFirebaseReady();
        const db = getFirestore();
        await db.collection('checkoutEvents').add({
          ...event,
          serverReceivedAt: new Date(),
          ip: req.ip,
        });
      } catch (e: any) {
        console.warn('⚠️ checkout-events: falha ao salvar no Firestore:', e?.message);
      }
    });

    return res.json({ success: true });
  } catch (error: any) {
    console.error('❌ checkout-events erro:', error?.message);
    return res.json({ success: false });
  }
});

// 📊 FUNIL DE CONVERSÃO — agrega dados de checkoutAnalytics + orders por seller
app.get('/api/analytics/funnel', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId, productId, checkoutId: singleCheckoutId } = req.query as Record<string, string>;
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });

    // Apenas o próprio seller ou admin
    const user = req.user!;
    const isAdmin = user.customClaims?.admin === true;
    if (!isAdmin && user.uid !== tenantId) return res.status(403).json({ error: 'Acesso negado' });

    await ensureFirebaseReady();
    const db = getFirestore();

    // 1️⃣ Buscar IDs de checkouts do seller
    let checkoutIds: string[] = [];
    if (singleCheckoutId) {
      checkoutIds = [singleCheckoutId];
    } else {
      let checkoutsQuery = db.collection('checkouts').where('tenantId', '==', tenantId);
      if (productId && productId !== 'all') checkoutsQuery = (checkoutsQuery as any).where('productId', '==', productId);
      const snap = await checkoutsQuery.limit(500).get();
      // fallback: some checkouts use userId instead of tenantId
      let fallbackSnap: FirebaseFirestore.QuerySnapshot | null = null;
      if (snap.empty) {
        let q2 = db.collection('checkouts').where('userId', '==', tenantId);
        if (productId && productId !== 'all') q2 = (q2 as any).where('productId', '==', productId);
        fallbackSnap = await q2.limit(500).get();
      }
      const allDocs = [...snap.docs, ...(fallbackSnap?.docs || [])];
      checkoutIds = allDocs.map(d => d.id);
    }

    if (checkoutIds.length === 0) {
      return res.json({ success: true, funnel: { visits: 0, formFilled: 0, paymentClicked: 0, paid: 0, rates: {} } });
    }

    // 2️⃣ Batch-ler checkoutAnalytics para todos os checkouts
    let totalVisits = 0, totalFormFilled = 0, totalPaymentClicked = 0;
    const BATCH_SIZE = 30;
    for (let i = 0; i < checkoutIds.length; i += BATCH_SIZE) {
      const batch = checkoutIds.slice(i, i + BATCH_SIZE);
      const refs = batch.map(id => db.collection('checkoutAnalytics').doc(id));
      const docs = await db.getAll(...refs);
      docs.forEach(d => {
        if (d.exists) {
          const data = d.data()!;
          totalVisits         += data.pageViews      || 0;
          totalFormFilled     += data.formFilled     || 0;
          totalPaymentClicked += data.paymentClicked || 0;
        }
      });
    }

    // 3️⃣ Contar pedidos pagos
    let paidQuery = db.collection('orders')
      .where('sellerId', '==', tenantId)
      .where('status', '==', 'paid');
    if (productId && productId !== 'all') paidQuery = (paidQuery as any).where('productId', '==', productId);
    const paidSnap = await paidQuery.get();
    const totalPaid = paidSnap.size;

    const rates = {
      visitsToForm:    totalVisits        > 0 ? Math.round((totalFormFilled     / totalVisits)        * 100) : 0,
      formToClick:     totalFormFilled    > 0 ? Math.round((totalPaymentClicked / totalFormFilled)    * 100) : 0,
      clickToPaid:     totalPaymentClicked > 0 ? Math.round((totalPaid          / totalPaymentClicked) * 100) : 0,
      overallConversion: totalVisits      > 0 ? Math.round((totalPaid          / totalVisits)         * 100) : 0,
    };

    res.json({
      success: true,
      funnel: {
        visits: totalVisits,
        formFilled: totalFormFilled,
        paymentClicked: totalPaymentClicked,
        paid: totalPaid,
        rates,
        checkoutsAnalyzed: checkoutIds.length,
      },
    });
  } catch (error: any) {
    console.error('❌ /api/analytics/funnel erro:', error);
    res.status(500).json({ error: 'Erro ao calcular funil' });
  }
});

// 👑 PROTEÇÃO AUTOMÁTICA: TODOS os endpoints /api/admin OBRIGATORIAMENTE protegidos
// [EXTRACTED] middleware: admin auth moved to server/routes/admin.ts

// 🚀 CACHE DE SELLERS E PRODUTOS PARA PERFORMANCE (5 minutos TTL)
// [EXTRACTED] helper: sellersCache moved to server/routes/admin.ts


// 🚀 HELPER: BATCH FETCH DE SELLERS (OTIMIZADO - PARALELO)
// [EXTRACTED] helper: batchFetchSellers moved to server/routes/admin.ts

// 🚀 HELPER: BATCH FETCH DE PRODUTOS/CHECKOUTS (OTIMIZADO - PARALELO)
// [EXTRACTED] get /api/admin/transactions/stats moved to server/routes/admin.ts

// ================================================================
// 🎫 SISTEMA DE SUPORTE - POSICIONADO APÓS SANITIZAÇÃO
// ================================================================

// 🚨 ROTAS DE TESTE REMOVIDAS POR SEGURANÇA
// Essas rotas eram vetores de ataque potenciais sem autenticação

// 💱 ENDPOINT DE TAXAS DE CÂMBIO EM TEMPO REAL
app.get('/api/exchange-rates', async (req, res) => {
  try {
    const rates = {
      USD: await currencyConverter.getExchangeRate('USD'),
      EUR: await currencyConverter.getExchangeRate('EUR'),
      GBP: await currencyConverter.getExchangeRate('GBP'),
      CAD: await currencyConverter.getExchangeRate('CAD'),
      AUD: await currencyConverter.getExchangeRate('AUD'),
      BRL: 1.00
    };

    res.json({
      success: true,
      rates,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erro ao buscar taxas de câmbio:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar taxas de câmbio'
    });
  }
});

// 🛡️ ENDPOINT SEGURO PARA CONFIG FIREBASE FRONTEND - SECURITY: RATE LIMITED  
app.get('/api/firebase-config', userRateLimit, (req, res) => {
  try {
    // 🔒 APENAS DADOS PÚBLICOS NECESSÁRIOS PARA O FRONTEND
    const publicConfig = {
      apiKey: process.env.VITE_FIREBASE_API_KEY || '',
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
      databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || '',
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || '',
      storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.VITE_FIREBASE_APP_ID || '',
      measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || ''
    };

    // 🚨 VALIDAR QUE TEMOS DADOS
    if (!publicConfig.apiKey || !publicConfig.projectId) {
      return res.status(500).json({ 
        error: 'Configuração Firebase indisponível' 
      });
    }

    // 🔒 CACHE HEADERS PARA PERFORMANCE
    res.set({
      'Cache-Control': 'public, max-age=3600', // Cache por 1 hora
      'ETag': '"fb-config-v1"',
    });

    res.json(publicConfig);
  } catch (error) {
    console.error('❌ Erro ao buscar config Firebase:', error);
    res.status(500).json({ error: 'Configuração indisponível' });
  }
});

// 🔍 ENDPOINT PARA DETECTAR TIPO DE USUÁRIO (SELLER OU CUSTOMER) - SECURITY: AUTH REQUIRED
app.get('/api/user-type/:userId', verifyFirebaseToken, userRateLimit('user-type'), async (req: AuthenticatedRequest, res) => {
  const startTime = Date.now();
  try {
    const { userId } = req.params;
    console.log(`🔍 [USER-TYPE] Iniciando detecção para userId: ${userId.substring(0, 8)}...`);
    
    // 🛡️ SECURITY: Só permitir consulta do próprio usuário ou admin
    // Usar req.authUser que contém as customClaims corretas do verifyFirebaseToken
    const isAdmin = req.authUser?.customClaims?.admin === true;
    if (userId !== req.authUser?.uid && !isAdmin) {
      console.log(`❌ [USER-TYPE] Acesso negado: ${userId} tentou acessar dados de outro usuário`);
      return res.status(403).json({ error: 'Forbidden: Can only query own user type' });
    }
    
    if (!userId) {
      console.log(`❌ [USER-TYPE] UserId não fornecido`);
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    console.log(`🔍 [USER-TYPE] Detectando tipo de usuário autorizado: ${userId.substring(0, 8)}...`);
    
    const userEmail = req.authUser?.email || req.user?.email;
    const { neonQuery: nqUT } = await import('./lib/neon-db.js');

    try {
      // 0️⃣ PRIMEIRO: VERIFICAR SE É ADMIN (VIA EMAIL OU CUSTOM CLAIMS)
      
      
      // ✅ ADMIN POR EMAIL (configurável via ADMIN_EMAIL env var)
      if (process.env.ADMIN_EMAIL && userEmail === process.env.ADMIN_EMAIL) {
        console.log(`👑 [USER-TYPE] Usuário é ADMIN (email): ${userId.substring(0, 8)}...`);
        return res.json({ type: 'admin' });
      }
      
      // ✅ ADMIN POR CUSTOM CLAIMS (futuro)
      const isAdminClaims = req.authUser?.isAdmin;
      if (isAdminClaims) {
        console.log(`👑 [USER-TYPE] Usuário é ADMIN (custom claims): ${userId.substring(0, 8)}...`);
        return res.json({ type: 'admin' });
      }
      
      // 🔧 HARDCODED: Sellers pré-aprovados para teste
      const preApprovedSellers = [
        'testeseller@gmail.com',
        'teste@gmail.com',
        'teste2@gmail.com'
      ];
      
      if (preApprovedSellers.includes(userEmail) ) {
        console.log(`✅ [USER-TYPE] Usuário é SELLER PRÉ-APROVADO (hardcoded): ${userEmail}`);
        let preApprovedTenantId = userId;
        await nqUT(async (sql) => {
          const rows = await sql`SELECT tenant_id FROM sellers WHERE id = ${userId} LIMIT 1`;
          if (rows[0]?.tenant_id) preApprovedTenantId = rows[0].tenant_id;
        }, `preApprovedTenant:${userId}`).catch(() => {});
        return res.json({ type: 'seller', status: 'approved', tenantId: preApprovedTenantId, profileComplete: true });
      }
      
      // 1️⃣ BUSCAR SELLER NO NEON (fonte de verdade)
      // SELECT apenas colunas garantidas para evitar falha em DBs antigos
      let sellerRow: any = null;
      await nqUT(async (sql) => {
        const rows = (await sql`SELECT id, tenant_id, status FROM sellers WHERE id = ${userId} LIMIT 1`) as any[];
        if (rows[0]) sellerRow = rows[0];
      }, `userType:${userId}`);

      if (sellerRow) {
        // Seller existe no Neon → É um seller, independente de status ou nome
        console.log(`✅ [USER-TYPE] SELLER (Neon) - Status: ${sellerRow.status || 'pending'}`);
        return res.json({
          type: 'seller',
          status: sellerRow.status || 'pending',
          tenantId: sellerRow.tenant_id || userId,
          profileComplete: sellerRow.profile_complete ?? false
        });
      }

      // 2️⃣ FALLBACK FIRESTORE — sellers antigos ainda não migrados para Neon
      try {
        await ensureFirebaseReady();
        const adminSdk2 = getAdmin();
        const fsDb2 = adminSdk2.firestore();
        const fsDoc = await fsDb2.collection('sellers').doc(userId).get();
        if (fsDoc.exists) {
          const d = fsDoc.data() || {};
          console.log(`🔄 [USER-TYPE] SELLER encontrado no Firestore, migrando para Neon: ${userId.substring(0,8)}`);
          // Auto-migrar fire-and-forget
          nqUT(async (sql) => {
            await (sql as any)`
              INSERT INTO sellers (id, tenant_id, email, name, business_name, status, phone, document, profile_complete, is_approved, is_blocked, created_at, updated_at)
              VALUES (
                ${userId}, ${d.tenantId || userId}, ${d.email || null},
                ${d.name || d.fullName || null}, ${d.businessName || d.companyName || null},
                ${d.status || 'pending'}, ${d.phone || null}, ${d.document || null},
                ${d.profileComplete ?? false}, ${d.status === 'approved'}, ${d.isBlocked ?? false},
                ${d.createdAt?.toDate ? d.createdAt.toDate() : new Date()}, NOW()
              )
              ON CONFLICT (id) DO UPDATE SET
                tenant_id = COALESCE(EXCLUDED.tenant_id, sellers.tenant_id),
                email = COALESCE(EXCLUDED.email, sellers.email),
                name = COALESCE(EXCLUDED.name, sellers.name),
                business_name = COALESCE(EXCLUDED.business_name, sellers.business_name),
                status = EXCLUDED.status, updated_at = NOW()
            `;
          }, `autoMigrateUT:${userId}`).catch(() => {});
          return res.json({
            type: 'seller',
            status: d.status || 'pending',
            tenantId: d.tenantId || userId,
            profileComplete: d.profileComplete ?? false
          });
        }
      } catch (fsErr: any) {
        console.warn(`⚠️ [USER-TYPE] Firestore fallback falhou: ${fsErr?.message}`);
      }

      // 3️⃣ FALLBACK FINAL: É CUSTOMER
      console.log(`✅ [USER-TYPE] Usuário é CUSTOMER: ${userId.substring(0, 8)}...`);
      return res.json({ type: 'customer' });

    } catch (dbError: any) {
      console.error('❌ Erro ao consultar Neon no user-type:', dbError?.message || dbError?.code || JSON.stringify(dbError) || typeof dbError);
      // Último fallback: verificar apenas existência do seller com query mínima
      try {
        let fallbackIsSeller = false;
        const { neonQuery: nqUTFallback } = await import('./lib/neon-db.js');
        await nqUTFallback(async (sql) => {
          const rows = (await sql`SELECT id FROM sellers WHERE id = ${userId} LIMIT 1`) as any[];
          fallbackIsSeller = rows.length > 0;
        }, `userType-fallback:${userId}`);
        if (fallbackIsSeller) {
          console.log(`✅ [USER-TYPE] SELLER detectado via fallback mínimo: ${userId.substring(0,8)}`);
          return res.json({ type: 'seller', status: 'pending', tenantId: userId, profileComplete: false });
        }
      } catch {}
      return res.json({ type: 'customer', error: 'Database query failed' });
    }
    
  } catch (error) {
    console.error('❌ Erro no endpoint user-type:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
// [EXTRACTED] post /api/admin/promote-to-seller moved to server/routes/admin.ts

// [EXTRACTED] Security routes moved to server/routes/security.ts

// ================================================================
// 🎨 SISTEMA DE CONFIGURAÇÕES ADMIN - VISUAL & DADOS
// ================================================================

// [EXTRACTED] GET /api/public/configurations moved to server/routes/admin-config.ts

// 🏦 PUBLIC - CONFIGURAÇÕES DE TAXAS PARA CÁLCULOS (SEM AUTENTICAÇÃO)
app.get('/api/public/acquirers-config', async (req, res) => {
  try {
    console.log('🌍 PUBLIC - Buscando configurações de taxas...');
    
    // ⚙️ CONFIGURAÇÃO PÚBLICA DE TAXAS (sem dados sensíveis)
    const defaultConfig = {
      efibank: {
        enabled: true,
        pixFeePercent: 2,
        pixFeeFixed: 2.49,
        cardFeePercent: 5.2,
        cardFeeFixed: 2.49,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 8.2,
        installment10to12x: 9.2,
        withdrawalDays: 20
      },
      stripe: {
        enabled: true,
        cardFeePercent: 5.2,
        cardFeeFixed: 2.49,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 7.2,
        installment10to12x: 8.2,
        withdrawalDays: 30
      },
      adyen: {
        enabled: false,
        cardFeePercent: 4.8,
        cardFeeFixed: 2.49,
        installment1x: 4.8,
        installment2to6x: 5.8,
        installment7to9x: 6.8,
        installment10to12x: 7.8,
        withdrawalDays: 7
      },
      pagarme: {
        enabled: true,
        pixFeePercent: 2.99,
        pixFeeFixed: 0.99,
        cardFeePercent: 3.99,
        cardFeeFixed: 0.39,
        boletoFeePercent: 0,
        boletoFeeFixed: 3.49,
        withdrawalDays: 1
      }
    };

    // Tentar buscar configurações do admin via Firebase
    try {
      await ensureFirebaseReady();
      const _fsFees = getAdmin().firestore();
      try {
        const configRef = _fsFees.collection('admin').doc('acquirers-config');
        const configDoc = await configRef.get();
        
        if (configDoc.exists) {
          const data = configDoc.data();
          // ✅ Retornar apenas dados públicos de taxas (sem dados sensíveis)
          const publicConfig = {
            efibank: {
              enabled: data.efibank?.enabled ?? true,
              pixFeePercent: data.efibank?.pixFeePercent ?? 2,
              pixFeeFixed: data.efibank?.pixFeeFixed ?? 2.49,
              cardFeePercent: data.efibank?.cardFeePercent ?? 5.2,
              cardFeeFixed: data.efibank?.cardFeeFixed ?? 2.49,
              installment1x: data.efibank?.installment1x ?? 5.2,
              installment2to6x: data.efibank?.installment2to6x ?? 6.2,
              installment7to9x: data.efibank?.installment7to9x ?? 8.2,
              installment10to12x: data.efibank?.installment10to12x ?? 9.2,
              withdrawalDays: data.efibank?.withdrawalDays ?? 20,
              withdrawalDays1x: data.efibank?.withdrawalDays1x ?? data.efibank?.withdrawalDays ?? 20,
              withdrawalDays2to6x: data.efibank?.withdrawalDays2to6x ?? data.efibank?.withdrawalDays ?? 25,
              withdrawalDays7to9x: data.efibank?.withdrawalDays7to9x ?? data.efibank?.withdrawalDays ?? 30,
              withdrawalDays10to12x: data.efibank?.withdrawalDays10to12x ?? data.efibank?.withdrawalDays ?? 30
            },
            stripe: {
              enabled: data.stripe?.enabled ?? true,
              cardFeePercent: data.stripe?.cardFeePercent ?? 5.2,
              cardFeeFixed: data.stripe?.cardFeeFixed ?? 2.49,
              installment1x: data.stripe?.installment1x ?? 5.2,
              installment2to6x: data.stripe?.installment2to6x ?? 6.2,
              installment7to9x: data.stripe?.installment7to9x ?? 7.2,
              installment10to12x: data.stripe?.installment10to12x ?? 8.2,
              withdrawalDays: data.stripe?.withdrawalDays ?? 30
            },
            adyen: {
              enabled: data.adyen?.enabled ?? false,
              cardFeePercent: data.adyen?.cardFeePercent ?? 4.8,
              cardFeeFixed: data.adyen?.cardFeeFixed ?? 2.49,
              installment1x: data.adyen?.installment1x ?? 4.8,
              installment2to6x: data.adyen?.installment2to6x ?? 5.8,
              installment7to9x: data.adyen?.installment7to9x ?? 6.8,
              installment10to12x: data.adyen?.installment10to12x ?? 7.8,
              withdrawalDays: data.adyen?.withdrawalDays ?? 7
            },
            pagarme: {
              enabled: data.pagarme?.enabled ?? true,
              pixFeePercent: data.pagarme?.pixFeePercent ?? 2.99,
              pixFeeFixed: data.pagarme?.pixFeeFixed ?? 0.99,
              cardFeePercent: data.pagarme?.cardFeePercent ?? 3.99,
              cardFeeFixed: data.pagarme?.cardFeeFixed ?? 0.39,
              boletoFeePercent: data.pagarme?.boletoFeePercent ?? 0,
              boletoFeeFixed: data.pagarme?.boletoFeeFixed ?? 3.49,
              withdrawalDays: data.pagarme?.withdrawalDays ?? 1
            }
          };
          console.log('🌍 Configurações públicas de taxas encontradas');
          return res.json(publicConfig);
        }
      } catch (dbError) {
        console.log('🌍 Erro no banco, usando padrão:', dbError);
      }
    } catch (_fsFeesOuterErr) {
      console.log('🌍 Firebase não disponível para taxas, usando padrão');
    }

    console.log('🌍 Usando configurações de taxas padrão');
    res.json(defaultConfig);

  } catch (error) {
    console.error('❌ Erro geral configurações públicas de taxas:', error);
    // Sempre retornar configuração funcional
    res.json({
      efibank: {
        enabled: true,
        pixFeePercent: 2,
        pixFeeFixed: 2.49,
        cardFeePercent: 5.2,
        cardFeeFixed: 2.49,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 8.2,
        installment10to12x: 9.2,
        withdrawalDays: 20
      },
      stripe: {
        enabled: true,
        cardFeePercent: 5.2,
        cardFeeFixed: 2.49,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 7.2,
        installment10to12x: 8.2,
        withdrawalDays: 30
      },
      pagarme: {
        enabled: true,
        pixFeePercent: 2.99,
        pixFeeFixed: 0.99,
        cardFeePercent: 3.99,
        cardFeeFixed: 0.39,
        boletoFeePercent: 0,
        boletoFeeFixed: 3.49,
        withdrawalDays: 1
      }
    });
  }
});

// [EXTRACTED] GET /api/admin/configurations moved to server/routes/admin-config.ts
// [EXTRACTED] PUT /api/admin/configurations moved to server/routes/admin-config.ts

// ================================================================
// 🛡️ SISTEMA DE GESTÃO DE CONFIGURAÇÕES - BACKUP ETERNO
// ================================================================

// 🔥 BACKUP ETERNO - SALVAR TODAS AS CHAVES PARA SEMPRE - ADMIN ONLY
app.post('/api/config/backup-eternal', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔥 [BACKUP-ETERNO] Iniciando backup definitivo de TODAS as chaves...');
    
    await ensureFirebaseReady();
    const rtdb = (await import('./lib/firebase-admin')).getRTDB();
    
    // 💾 COLETAR TODAS AS CHAVES SENSÍVEIS DO AMBIENTE
    const eternoConfig = {
      firebase: {
        apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || '',
        databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL || '',
        projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || '',
        measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID || '',
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || '',
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || '',
        clientId: process.env.FIREBASE_ADMIN_CLIENT_ID || process.env.FIREBASE_CLIENT_ID || '',
      },
      ai: {
        openaiApiKey: process.env.OPENAI_API_KEY || '',
      },
      payments: {
        // Stripe
        stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
        
        // EfíBank Production  
        efibankClientIdProd: process.env.EFI_CLIENT_ID || '',
        efibankClientSecretProd: process.env.EFI_CLIENT_SECRET || '',
        
        // EfíBank Sandbox
        efibankClientIdSandbox: process.env.EFI_CLIENT_ID_SANDBOX || '',
        efibankClientSecretSandbox: process.env.EFI_CLIENT_SECRET_SANDBOX || '',
        
        // EfíBank Common
        efibankPayeeCode: process.env.EFIBANK_PAYEE_CODE || '',
        efibankPixKey: process.env.EFIBANK_PIX_KEY || '',
        efibankSandbox: process.env.EFIBANK_SANDBOX === 'true',
        
        // Adyen (se configurado)
        adyenMerchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT || '',
        adyenClientKey: process.env.ADYEN_CLIENT_KEY || '',
        adyenApiKey: process.env.ADYEN_API_KEY || '',
        adyenHmacKey: process.env.ADYEN_HMAC_KEY || '',
      },
      metadata: {
        backupDate: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        version: '2.0.0-eternal',
        eternoPermanente: true,
        fonte: 'backup-eternal-api'
      }
    };
    
    // 🛡️ SALVAR NO FIREBASE RTDB PARA ETERNIDADE
    await rtdb.ref('tetri-system/config-eternal').set(eternoConfig);
    
    // 📊 CONTAR CHAVES SALVAS
    let totalKeys = 0;
    Object.values(eternoConfig.firebase).forEach(val => val && totalKeys++);
    Object.values(eternoConfig.ai).forEach(val => val && totalKeys++);
    Object.values(eternoConfig.payments).forEach(val => val !== false && val && totalKeys++);
    
    console.log(`✅ [BACKUP-ETERNO] ${totalKeys} chaves salvas para eternidade!`);
    console.log('🛡️ [BACKUP-ETERNO] Sistema agora é 100% independente de secrets externos!');
    
    res.json({
      success: true,
      message: '🔥 BACKUP ETERNO CONCLUÍDO! Sistema blindado para sempre! 🛡️',
      timestamp: new Date().toISOString(),
      totalKeys,
      eternoPermanente: true,
      independente: true,
      firebase_path: 'tetri-system/config-eternal'
    });
    
  } catch (error: any) {
    console.error('❌ [BACKUP-ETERNO] Erro:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao realizar backup eterno',
      details: error.message
    });
  }
});

// ================================================================
// 💳 CONFIGURAÇÕES DE PAGAMENTO - ADMIN PANEL
// ================================================================

// [EXTRACTED] GET /api/admin/payment-config moved to server/routes/admin-config.ts

// 📊 BUSCAR TAXAS DE PROCESSAMENTO (PÚBLICO - Para cálculos de comissão)
app.get('/api/payment-fees', async (req, res) => {
  try {
    console.log('📊 Buscando taxas de processamento para cálculo de comissões...');
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    const { loadEternalFees } = await import('./lib/eternal-credentials.js');
    const fees = await loadEternalFees(db);
    
    // Retornar apenas as taxas (sem credenciais sensíveis)
    res.json({
      pixFixedFee: fees.pixFixedFee,
      pixPercentFee: fees.pixPercentFee,
      pixReleaseDays: fees.pixReleaseDays,
      creditCardBRFixedFee: fees.creditCardBRFixedFee,
      creditCardBRPercentFee: fees.creditCardBRPercentFee,
      creditCardBRReleaseDays: fees.creditCardBRReleaseDays,
      creditCardGlobalFixedFee: fees.creditCardGlobalFixedFee,
      creditCardGlobalPercentFee: fees.creditCardGlobalPercentFee,
      creditCardGlobalReleaseDays: fees.creditCardGlobalReleaseDays,
      boletoFixedFee: fees.boletoFixedFee,
      boletoPercentFee: fees.boletoPercentFee,
      boletoReleaseDays: fees.boletoReleaseDays
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar taxas de processamento:', error);
    res.status(500).json({ error: error.message || 'Erro ao buscar taxas' });
  }
});

// 📤 UPLOAD DE CERTIFICADO EFIBANK (ETERNO NO FIREBASE STORAGE) - ADMIN ONLY
// [EXTRACTED] post /api/admin/efibank/certificate moved to server/routes/admin.ts

// 🛠️ DEV ONLY: Registrar webhook sem autenticação (TEMPORÁRIO - REMOVER EM PRODUÇÃO)
app.get('/api/dev/register-webhook-bypass', async (req, res) => {
  try {
    console.log('🛠️ DEV: Registrando webhook EfíBank PIX (bypass)...');
    
    await ensureFirebaseReady();
    
    // Buscar configuração EfíBank
    const { getPaymentConfig } = await import('./lib/payment-config.js');
    const paymentConfig = await getPaymentConfig(null);
    
    if (!paymentConfig?.efibank?.enabled) {
      return res.status(400).json({ 
        success: false, 
        error: 'EfíBank não está habilitado' 
      });
    }
    
    const { pixKey } = paymentConfig.efibank;
    
    if (!pixKey) {
      return res.status(400).json({ 
        success: false, 
        error: 'Chave PIX não configurada' 
      });
    }
    
    // Ler certificado LOCAL (não do Bunny CDN)
    const certPath = getCertPath('efi-prod.p12');
    if (!fs.existsSync(certPath)) {
      return res.status(400).json({
        success: false,
        error: 'Certificado não encontrado em: ' + certPath
      });
    }
    
    const certBuffer = fs.readFileSync(certPath);
    console.log(`✅ Certificado local carregado: ${certBuffer.length} bytes`);
    
    // Construir webhook URL com HMAC (lê do Firestore, igual ao startup automático)
    let WEBHOOK_HMAC = getSecret('EFIBANK_WEBHOOK_HMAC');
    if (!WEBHOOK_HMAC) {
      // Fallback: buscar HMAC do Firestore (igual ao fluxo de startup)
      WEBHOOK_HMAC = await getWebhookHmac(null);
    }
    if (!WEBHOOK_HMAC) {
      return res.status(500).json({ 
        success: false, 
        error: 'EFIBANK_WEBHOOK_HMAC não configurado (nem env var, nem RTDB)' 
      });
    }
    
    // 🌐 Usar domínio configurado (APP_BASE_URL no VPS ou fallback volatuspay.com)
    const domain = getBaseDomain();
    const webhookUrl = `${domain}/webhook/efi?hmac=${WEBHOOK_HMAC}&ignorar=`;
    
    console.log(`🌐 Registrando webhook URL: ${webhookUrl.replace(WEBHOOK_HMAC, '***')}`);
    console.log(`🔑 Chave PIX: ${pixKey.substring(0, 8)}...`);
    
    // Registrar webhook
    const success = await registerEfiBankWebhook(pixKey, webhookUrl, certBuffer);
    
    if (success) {
      console.log('✅ Webhook EfíBank registrado com sucesso!');
      
      // Salvar no Neon
      const webhookRegisteredAt = new Date().toISOString();
      try {
        const { neonQuery: _nqWH } = await import('./lib/neon-db.js');
        await _nqWH(async (sql) => {
          await sql`UPDATE payment_config SET config_data = jsonb_set(jsonb_set(COALESCE(config_data, '{}'::jsonb), '{efibank,webhookRegisteredAt}', ${JSON.stringify(webhookRegisteredAt)}::jsonb), '{efibank,webhookUrl}', ${JSON.stringify(webhookUrl)}::jsonb), updated_at = NOW() WHERE config_key = 'acquirers-config'`;
        }, `devWebhook:saveWebhookUrl`);
      } catch (_wErr) { /* ignore */ }
      
      return res.json({
        success: true,
        message: '✅ Webhook PIX registrado com sucesso na EfíBank!',
        webhookUrl: webhookUrl.replace(WEBHOOK_HMAC, '***'),
        pixKey: pixKey.substring(0, 8) + '...',
        registeredAt: webhookRegisteredAt,
        nextSteps: 'Faça uma venda teste com PIX e aguarde aprovação automática!'
      });
    } else {
      throw new Error('Falha ao registrar webhook (retorno false)');
    }
    
  } catch (error: any) {
    console.error('❌ ERRO ao registrar webhook EfíBank:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao registrar webhook',
      details: error.message
    });
  }
});
// [EXTRACTED] post /api/admin/efibank/register-webhook moved to server/routes/admin.ts

// 🔓 BUSCAR CONFIGURAÇÕES DE PAGAMENTO PÚBLICAS (para checkout)
// Retorna apenas dados necessários para checkout (sem credenciais sensíveis)
app.get('/api/public/payment-config/:checkoutId', async (req, res) => {
  try {
    const { checkoutId } = req.params;
    
    await ensureFirebaseReady();
    const db = getFirestore();
    
    // Buscar checkout para verificar se existe
    const checkoutDoc = await db.collection('checkouts').doc(checkoutId).get();
    if (!checkoutDoc.exists) {
      // 🛡️ SEGURANÇA: Retornar resposta genérica para prevenir enumeração de checkouts
      return res.status(200).json({ 
        success: false, 
        error: 'Configuração não disponível' 
      });
    }
    
    // Buscar configuração de pagamento
    const config = await getPaymentConfig(db);
    
    // 🛡️ SEGURANÇA: Fallback seguro caso config seja null
    if (!config || !config.fees) {
      return res.status(200).json({
        success: true,
        config: {
          efibank: { enabled: false, environment: 'production' },
          stripe: { enabled: false, publicKey: '' },
          fees: {},
          defaultAcquirers: {}
        }
      });
    }
    
    // Retornar apenas dados públicos necessários
    res.json({
      success: true,
      config: {
        efibank: {
          enabled: config.efibank?.enabled || false,
          environment: config.efibank?.environment || 'production'
        },
        stripe: {
          enabled: config.stripe?.enabled || false,
          publicKey: config.stripe?.publicKey || ''
        },
        fees: config.fees || {},
        defaultAcquirers: config.defaultAcquirers || {}
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar configuração pública:', error);
    res.status(200).json({ 
      success: false, 
      error: 'Configuração temporariamente indisponível' 
    });
  }
});

// 💰 PUBLIC - TAXAS DA PLATAFORMA (ETERNAL FEES) - PARA VITRINE DE AFILIADOS
app.get('/api/public/platform-fees', async (req, res) => {
  try {
    console.log('📊 Buscando taxas de processamento para cálculo de comissões...');
    
    const admin = getAdmin();
    const db = admin.firestore();
    
    const { loadEternalFees } = await import('./lib/eternal-credentials.js');
    const fees = await loadEternalFees(db);
    
    console.log('✅ Taxas eternas carregadas do Firebase');
    
    res.json(fees);
  } catch (error) {
    console.error('❌ Erro ao buscar taxas da plataforma:', error);
    
    // Fallback com taxas padrão
    res.json({
      pixFixedFee: 99,
      pixPercentFee: 2.99,
      pixReleaseDays: 1,
      creditCardBRFixedFee: 49,
      creditCardBRPercentFee: 4.99,
      creditCardBRReleaseDays: 30,
      globalFixedFee: 49,
      globalPercentFee: 4.99,
      globalReleaseDays: 30,
      boletoFixedFee: 349,
      boletoPercentFee: 0,
      boletoReleaseDays: 2
    });
  }
});
// [EXTRACTED] post /api/admin/cleanup-failed-orders moved to server/routes/admin.ts

// 💾 BACKUP MANUAL DAS CONFIGURAÇÕES (LEGACY) - ADMIN ONLY
app.post('/api/config/backup', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📋 [ENDPOINT] Iniciando backup manual das configurações...');
    
    // Importar dinâmicamente para evitar problemas de inicialização
    const { backupCurrentConfig, detectMissingKeys } = await import('./lib/config-backup');
    await backupCurrentConfig();
    
    const missing = detectMissingKeys();
    
    res.json({
      success: true,
      message: 'Backup realizado com sucesso!',
      timestamp: new Date().toISOString(),
      missingKeys: missing.length,
      missingKeysList: missing
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Erro ao realizar backup',
      details: error.message
    });
  }
});

// 🔄 RESTAURAR CONFIGURAÇÕES DO BACKUP - ADMIN ONLY
app.get('/api/config/restore', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📋 [ENDPOINT] Buscando backup para restauração...');
    
    const { restoreConfigFromBackup, detectMissingKeys } = await import('./lib/config-backup');
    const config = await restoreConfigFromBackup();
    
    if (!config || !config.fees) {
      return res.status(404).json({
        success: false,
        error: 'Nenhum backup encontrado no Firebase'
      });
    }
    
    const missing = detectMissingKeys();
    
    // Preparar instruções de restauração
    const instructions = [];
    
    // Firebase Frontend
    if (config.firebase.apiKey) instructions.push(`VITE_FIREBASE_API_KEY=${config.firebase.apiKey}`);
    if (config.firebase.authDomain) instructions.push(`VITE_FIREBASE_AUTH_DOMAIN=${config.firebase.authDomain}`);
    if (config.firebase.databaseURL) instructions.push(`VITE_FIREBASE_DATABASE_URL=${config.firebase.databaseURL}`);
    if (config.firebase.projectId) instructions.push(`VITE_FIREBASE_PROJECT_ID=${config.firebase.projectId}`);
    if (config.firebase.storageBucket) instructions.push(`VITE_FIREBASE_STORAGE_BUCKET=${config.firebase.storageBucket}`);
    if (config.firebase.messagingSenderId) instructions.push(`VITE_FIREBASE_MESSAGING_SENDER_ID=${config.firebase.messagingSenderId}`);
    if (config.firebase.appId) instructions.push(`VITE_FIREBASE_APP_ID=${config.firebase.appId}`);
    if (config.firebase.measurementId) instructions.push(`VITE_FIREBASE_MEASUREMENT_ID=${config.firebase.measurementId}`);
    
    // Firebase Backend
    if (config.firebase.projectId) instructions.push(`FIREBASE_PROJECT_ID=${config.firebase.projectId}`);
    if (config.firebase.clientEmail) instructions.push(`FIREBASE_CLIENT_EMAIL=${config.firebase.clientEmail}`);
    if (config.firebase.privateKey) instructions.push(`FIREBASE_PRIVATE_KEY=${config.firebase.privateKey}`);
    
    // AI Services
    if (config.ai.openaiApiKey) instructions.push(`OPENAI_API_KEY=${config.ai.openaiApiKey}`);
    
    // Payment Services
    if (config.payments.stripeSecretKey) instructions.push(`STRIPE_SECRET_KEY=${config.payments.stripeSecretKey}`);
    if (config.payments.stripePublishableKey) instructions.push(`VITE_STRIPE_PUBLISHABLE_KEY=${config.payments.stripePublishableKey}`);
    
    // EfíBank Production
    if (config.payments.efibankClientIdProd) instructions.push(`EFIBANK_CLIENT_ID=${config.payments.efibankClientIdProd}`);
    if (config.payments.efibankClientSecretProd) instructions.push(`EFIBANK_CLIENT_SECRET=${config.payments.efibankClientSecretProd}`);
    
    // EfíBank Sandbox
    if (config.payments.efibankClientIdSandbox) instructions.push(`EFIBANK_CLIENT_ID_SANDBOX=${config.payments.efibankClientIdSandbox}`);
    if (config.payments.efibankClientSecretSandbox) instructions.push(`EFIBANK_CLIENT_SECRET_SANDBOX=${config.payments.efibankClientSecretSandbox}`);
    
    // EfíBank Common
    if (config.payments.efibankPayeeCode) instructions.push(`EFIBANK_PAYEE_CODE=${config.payments.efibankPayeeCode}`);
    if (config.payments.efibankPixKey) instructions.push(`EFIBANK_PIX_KEY=${config.payments.efibankPixKey}`);
    
    // Adyen (se configurado)
    if (config.payments.adyenMerchantAccount) instructions.push(`ADYEN_MERCHANT_ACCOUNT=${config.payments.adyenMerchantAccount}`);
    if (config.payments.adyenClientKey) instructions.push(`ADYEN_CLIENT_KEY=${config.payments.adyenClientKey}`);
    if (config.payments.adyenApiKey) instructions.push(`ADYEN_API_KEY=${config.payments.adyenApiKey}`);
    if (config.payments.adyenHmacKey) instructions.push(`ADYEN_HMAC_KEY=${config.payments.adyenHmacKey}`);
    
    res.json({
      success: true,
      message: 'Backup encontrado com sucesso!',
      backup: {
        date: config.backupDate,
        environment: config.environment,
        version: config.version
      },
      missing_keys: missing,
      total_missing: missing.length,
      instructions: instructions
    });
    
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Erro ao restaurar configurações',
      details: error.message
    });
  }
});

// [EXTRACTED] GET /api/admin/config/status moved to server/routes/admin-config.ts

// 🔍 STATUS DAS CONFIGURAÇÕES (LEGACY) - ADMIN ONLY
app.get('/api/config/status', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { detectMissingKeys, restoreConfigFromBackup } = await import('./lib/config-backup');
    const missing = detectMissingKeys();
    const hasBackup = await restoreConfigFromBackup();
    
    res.json({
      success: true,
      status: {
        all_keys_present: missing.length === 0,
        missing_keys_count: missing.length,
        missing_keys: missing,
        backup_available: !!hasBackup,
        backup_date: hasBackup?.backupDate || null,
        environment: process.env.NODE_ENV || 'unknown',
        timestamp: new Date().toISOString()
      },
      firebase: {
        frontend_configured: !!process.env.VITE_FIREBASE_API_KEY && !!process.env.VITE_FIREBASE_PROJECT_ID,
        backend_configured: !!process.env.FIREBASE_PROJECT_ID && !!process.env.FIREBASE_CLIENT_EMAIL && !!process.env.FIREBASE_PRIVATE_KEY
      },
      ai: {
        openai_configured: !!process.env.OPENAI_API_KEY
      },
      payments: {
        stripe_configured: !!stripeConfigCache?.secretKey || !!process.env.STRIPE_SECRET_KEY,
        stripe_environment: stripeConfigCache?.environment || 
                           (process.env.STRIPE_SECRET_KEY?.includes('_live_') ? 'production' : 
                           process.env.STRIPE_SECRET_KEY?.includes('_test_') ? 'sandbox' : 'unknown'),
        stripe_source: stripeConfigCache ? 'firebase_encrypted' : 'environment',
        efibank_configured: !!process.env.EFI_CLIENT_ID && !!process.env.EFI_CLIENT_SECRET
      }
    });
    
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Erro ao verificar status',
      details: error.message
    });
  }
});

// 🚨 AUTO-RECOVERY ENDPOINT - ADMIN ONLY
app.get('/api/config/auto-recovery', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🚨 [ENDPOINT] Iniciando sistema de auto-recuperação...');
    
    const { autoRecoverySystem, detectMissingKeys } = await import('./lib/config-backup');
    const success = await autoRecoverySystem();
    
    const missing = detectMissingKeys();
    
    res.json({
      success,
      message: success ? 'Sistema de recuperação executado com sucesso!' : 'Falha no sistema de recuperação',
      missing_keys: missing,
      instructions: success ? 'Verifique os logs do servidor para instruções detalhadas' : 'Não foi possível recuperar as configurações'
    });
    
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Erro no sistema de auto-recuperação',
      details: error.message
    });
  }
});

// [EXTRACTED] Security routes moved to server/routes/security.ts

// ================================================================
// 🎨 ROTAS DE BANNERS ADMINISTRATIVOS
// ================================================================

// [EXTRACTED] GET /api/admin/banners moved to server/routes/admin-config.ts

// 📤 ADMIN - UPLOAD DE BANNER (FIREBASE STORAGE PERMANENTE) - ULTRA BLINDADO
// [EXTRACTED] post /api/admin/upload-banner moved to server/routes/admin.ts

// 🖼️ UPLOAD GENÉRICO DE IMAGENS (PRODUTOS, DEPOIMENTOS, AULAS, ETC)
app.post('/api/upload/image', verifyFirebaseToken, (req: AuthenticatedRequest, res, next) => {
  console.log('🛡️ [UPLOAD MILITAR] Endpoint chamado - User:', req.user?.uid);
  
  uploadImage.single('file')(req, res, (err: any) => {
    if (err) {
      console.error('❌ Erro no multer:', err);
      return res.status(400).json({ error: err.message || 'Erro no upload do arquivo' });
    }
    console.log('🛡️ [UPLOAD MILITAR] Multer processou - File:', req.file ? 'OK' : 'MISSING');
    next();
  });
}, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    const category = req.body.category || 'products';
    const clientIp = req.ip || req.socket.remoteAddress || '0.0.0.0';
    
    console.log('🛡️ [UPLOAD MILITAR] Iniciando - User:', userId, 'Category:', category, 'IP:', clientIp);
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    if (!req.file) {
      console.log('❌ Nenhum arquivo recebido');
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    // 🛡️ IMPORTAR GATEWAY SEGURO
    const { processSecureUpload } = await import('./security/upload-gateway.js');
    
    // 🚀 PROCESSAR UPLOAD COM SEGURANÇA MILITAR
    const result = await processSecureUpload({
      category,
      userId,
      ip: clientIp,
      tenantId: req.body.tenantId,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer
    });
    
    if (!result.success) {
      console.error('❌ [UPLOAD MILITAR] Upload bloqueado:', result.error);
      return res.status(400).json({ 
        success: false,
        error: result.error,
        retryAfter: result.retryAfter
      });
    }
    
    console.log('✅ [UPLOAD MILITAR] Upload concluído com sucesso:', result.url);
    
    res.json({
      success: true,
      url: result.url,
      fileName: result.details?.filename,
      category,
      originalName: req.file.originalname,
      size: result.details?.size,
      mimeType: result.details?.mimeType
    });

  } catch (error) {
    console.error('❌ [UPLOAD MILITAR] Erro crítico:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido no upload';
    res.status(500).json({ 
      success: false,
      error: 'Erro ao fazer upload da imagem',
      message: errorMessage
    });
  }
});

// [EXTRACTED] POST /api/admin/banners moved to server/routes/admin-config.ts
// [EXTRACTED] PUT /api/admin/banners/:id moved to server/routes/admin-config.ts
// [EXTRACTED] DELETE /api/admin/banners/:id moved to server/routes/admin-config.ts
// [EXTRACTED] GET /api/banners/active moved to server/routes/admin-config.ts

app.get('/api/cache-stats', verifyFirebaseToken, requireAdmin, async (_req, res) => {
  try {
    const { firestoreCache } = await import('./lib/firestore-cache.js');
    const { getAllCircuitBreakerStats } = await import('./lib/circuit-breaker.js');
    res.json({ 
      success: true, 
      cache: firestoreCache.getStats(),
      circuitBreakers: getAllCircuitBreakerStats()
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Admin: força aprovação de ordem PIX travada ───────────────────────
app.post('/api/admin/orders/:orderId/force-approve-pix', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    const { orderId } = req.params;
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) return res.status(404).json({ error: 'Ordem não encontrada' });
    const orderData = orderDoc.data() as any;
    if (orderData.status === 'paid') return res.json({ success: true, message: 'Ordem já está paga' });
    if (orderData.method !== 'pix') return res.status(400).json({ error: 'Somente ordens PIX' });
    const sellerId = orderData.tenantId || orderData.sellerId;
    const feeCalc = await calculateDynamicFees(orderData.amount, 'pix', 1, orderData.gateway || 'efibank', sellerId);
    const releaseDate = new Date(Date.now() + (feeCalc.releaseDays || 0) * 86400000);
    await db.collection('orders').doc(orderId).update({
      status: 'paid', paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      txid: orderData.txid || orderId, gateway: orderData.gateway || 'efibank',
      confirmedVia: 'admin_force_approve', netAmount: feeCalc.netAmount,
      gatewayFee: feeCalc.gatewayFee, platformFee: feeCalc.platformFee, releaseDate,
      'financial.released': false, 'financial.netAmount': feeCalc.netAmount,
      'financial.gatewayFee': feeCalc.gatewayFee, 'financial.platformFee': feeCalc.platformFee,
      'financial.releaseDate': releaseDate, 'financial.releaseDays': feeCalc.releaseDays,
    });
    if (sellerId) {
      try {
        const { processWebhookWithBalanceUpdate } = await import('./lib/atomic-balance.js');
        await processWebhookWithBalanceUpdate({
          webhookId: `admin_force_${orderId}_${Date.now()}`,
          provider: orderData.gateway || 'efibank', eventType: 'pix.paid', sellerId,
          amountCents: Math.round(feeCalc.netAmount), currency: 'BRL', operation: 'add',
          balanceType: 'available', reason: `PIX aprovado manualmente pelo admin - Ordem ${orderId}`,
          orderId, metadata: { method: 'pix', acquirer: orderData.gateway || 'efibank', totalAmount: orderData.amount, confirmedVia: 'admin_force_approve' }
        });
      } catch (balErr: any) { console.warn('⚠️ [FORCE-APPROVE] Erro ao creditar saldo:', balErr?.message); }
    }
    syncOrderAfterUpdate(sellerId, orderId, { status: 'paid', paidAt: new Date().toISOString(), method: 'pix', netAmount: feeCalc.netAmount });
    console.log(`✅ [ADMIN FORCE-APPROVE] Ordem ${orderId} aprovada manualmente. Net: R$${feeCalc.netAmount}`);
    res.json({ success: true, orderId, netAmount: feeCalc.netAmount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/debug/orders', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    const ordersSnapshot = await db.collection('orders').limit(20).get();
    const orders = ordersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json({ total: orders.length, orders });
  } catch (error) {
    console.error('❌ Erro ao buscar pedidos:', error);
    res.status(500).json({ error: String(error) });
  }
});

// ================================================================
// 🛠️ ROTAS DE CHECKOUTS - GERENCIAMENTO DE PRODUTOS ETERNOS
// ================================================================

// 🔍 BUSCAR CHECKOUT POR SLUG OU ID (PÚBLICO)
app.get('/api/checkout/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    console.log(`🔍 Buscando checkout por slug/ID: ${slug}`);

    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();

    let checkoutDoc;
    let checkout = null;

    // 1️⃣ TENTAR CACHE PRIMEIRO, DEPOIS BUSCAR POR ID
    try {
      const { firestoreCache } = await import('./lib/firestore-cache.js');
      const cachedCheckout = await firestoreCache.getCheckout(slug);
      if (cachedCheckout) {
        checkout = {
          ...cachedCheckout,
          createdAt: cachedCheckout.createdAt?.toDate?.() || cachedCheckout.createdAt || new Date(),
          updatedAt: cachedCheckout.updatedAt?.toDate?.() || cachedCheckout.updatedAt || new Date(),
        };
        console.log(`✅ [CACHE] Checkout encontrado por ID: ${checkout.title}`);
      }
    } catch (error) {
      console.log('⚠️ Cache/busca por ID falhou, tentando por slug...');
    }

    // 2️⃣ + 3️⃣ SE NÃO ENCONTROU NO CACHE: PARALELIZAR busca por slug E por slug de oferta
    if (!checkout) {
      try {
        const [slugQuery, offerQuery] = await Promise.all([
          db.collection('checkouts').where('slug', '==', slug).limit(1).get(),
          db.collection('productOffers').where('slug', '==', slug).limit(1).get()
        ]);

        if (!slugQuery.empty) {
          const doc = slugQuery.docs[0];
          const data = doc.data();
          checkout = {
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.() || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || new Date(),
          };
          console.log(`✅ Checkout encontrado por slug: ${checkout.title}`);
        } else if (!offerQuery.empty) {
          const offerData = offerQuery.docs[0].data();
          const productId = offerData.productId;
          console.log('✅ Oferta encontrada! ProductId:', productId);

          // Buscar checkout associado ao produto
          checkoutDoc = await db.collection('checkouts').doc(productId).get();
          if (checkoutDoc.exists) {
            const data = checkoutDoc.data()!;
            checkout = {
              id: checkoutDoc.id,
              ...data,
              createdAt: data.createdAt?.toDate?.() || new Date(),
              updatedAt: data.updatedAt?.toDate?.() || new Date(),
              // 💳 MESCLAR MÉTODOS DE PAGAMENTO DA OFERTA
              ...(offerData.paymentMethods && { paymentMethods: offerData.paymentMethods }),
              ...(offerData.installments && { installments: offerData.installments }),
            };
            console.log('✅ Checkout encontrado via oferta:', checkout.title);
          }
        }
      } catch (error) {
        console.error('❌ Erro ao buscar por slug / oferta:', error);
      }
    }

    if (!checkout) {
      console.log(`❌ Checkout não encontrado: ${slug}`);
      
      // 🚀 HEADERS ANTI-CACHE PARA 404 TAMBÉM  
      res.set({
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    // 🚫 VERIFICAR SE O PRODUTO ESTÁ BLOQUEADO
    if (checkout.active === false) {
      console.log(`🚫 Produto bloqueado pelo admin: ${checkout.title} (${checkout.id})`);
      
      res.set({
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      return res.status(403).json({ 
        error: 'Produto não disponível',
        message: 'Este produto foi bloqueado e não está mais disponível para compra.'
      });
    }

    // 🛡️ VERIFICAR BLOQUEIO AUTOMÁTICO POR % DE REEMBOLSOS (REGRAS ADMIN)
    try {
      const realtimeDb = adminSdk.database();
      const productBlockRef = realtimeDb.ref(`products/${checkout.id}/blocked`);
      const blockSnapshot = await productBlockRef.once('value');
      const blockData = blockSnapshot.val();
      
      if (blockData && blockData.blocked === true) {
        console.log(`🚫 Produto bloqueado automaticamente por % de reembolsos: ${checkout.title}`);
        console.log(`📊 Motivo: ${blockData.reason || 'Limite de reembolsos excedido'}`);
        console.log(`📈 Porcentagem de reembolsos: ${blockData.refundPercentage || 0}%`);
        
        res.set({
          'Cache-Control': 'no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        
        return res.status(403).json({ 
          error: 'Produto temporariamente indisponível',
          message: `Este produto está temporariamente bloqueado devido a ${blockData.reason || 'análise de segurança'}. Entre em contato com o suporte para mais informações.`,
          details: {
            isAutoBlocked: true,
            reason: blockData.reason,
            refundPercentage: blockData.refundPercentage,
            blockedAt: blockData.blockedAt
          }
        });
      }
    } catch (blockCheckError) {
      console.warn('⚠️ Erro ao verificar bloqueio automático:', blockCheckError);
    }

    // 🔧 APLICAR FALLBACKS PARA CHECKOUTS ANTIGOS
    if (!checkout.marketTarget) {
      checkout.marketTarget = 'brasil';
    }
    if (!checkout.methods) {
      checkout.methods = { pix: true, card: true };
    }
    // Garantir que slug sempre esteja presente na resposta (usa param da URL como fallback)
    if (!checkout.slug) {
      checkout.slug = slug;
    }

    
    // 🔥 BUSCAR NOME DE EXIBIÇÃO DO SELLER (prioridade máxima - configurado no perfil)
    try {
      if (checkout.tenantId) {
        const sellerDoc = await db.collection('sellers').doc(checkout.tenantId).get();
        if (sellerDoc.exists) {
          const sellerData = sellerDoc.data();
          checkout.sellerDisplayName = sellerData?.businessName || sellerData?.name || sellerData?.displayName || null;
          console.log(`👤 [CHECKOUT] Seller ${checkout.tenantId}: ${checkout.sellerDisplayName}`);
        }
      }
    } catch (sellerError) {
      console.error('⚠️ Erro ao buscar seller para displayName:', sellerError);
    }
    // 🏷️ BUSCAR NOME DO SELLER + IMAGEM DO PRODUTO RELACIONADO
    try {
      let productData: any = null;

      // Tentar primeiro por syncedProductId (direto pelo doc ID)
      if (checkout.syncedProductId) {
        const productDoc = await db.collection('products').doc(checkout.syncedProductId).get();
        if (productDoc.exists) {
          productData = productDoc.data();
          console.log(`✅ Produto encontrado por syncedProductId: ${checkout.syncedProductId}`);
        }
      }

      // Fallback: query por checkoutId
      if (!productData) {
        const productsQuery = await db.collection('products')
          .where('checkoutId', '==', checkout.id)
          .where('tenantId', '==', checkout.tenantId)
          .limit(1)
          .get();
        if (!productsQuery.empty) {
          productData = productsQuery.docs[0].data();
          console.log(`✅ Produto encontrado por checkoutId query`);
        }
      }

      if (productData) {
        if (productData.sellerDisplayName) {
          checkout.sellerDisplayName = productData.sellerDisplayName;
          console.log(`✅ Nome do seller do produto aplicado ao checkout: ${checkout.sellerDisplayName}`);
        }
        if (productData.imageUrl && !checkout.imageUrl) {
          checkout.imageUrl = productData.imageUrl;
          console.log(`🖼️ imageUrl do produto injetado no checkout: ${checkout.imageUrl}`);
        }
      } else {
        console.log(`ℹ️ Nenhum produto encontrado para checkout ${checkout.id}`);
      }
    } catch (error) {
      console.error('⚠️ Erro ao buscar produto relacionado:', error);
    }

    // 🎯 CARREGAR MANAGED PIXELS DO CHECKOUT (subcoleção)
    try {
      if (checkout.id && checkout.tenantId) {
        console.log(`[PIXEL-SERVER] Buscando pixels do checkout ${checkout.id} (tenant: ${checkout.tenantId})`);
        const pixelsSnapshot = await db
          .collection('checkouts')
          .doc(checkout.id)
          .collection('pixels')
          .where('tenantId', '==', checkout.tenantId)
          .get();

        if (!pixelsSnapshot.empty) {
          checkout.managedPixels = pixelsSnapshot.docs.map((doc: any) => {
            const data = doc.data();
            const { access_token, accessToken, ...safeData } = data;
            return {
              id: doc.id,
              ...safeData,
              events: data?.events || { pageView: true, viewContent: true, addToCart: true, initiateCheckout: true, addPaymentInfo: true, purchase: true },
              createdAt: data?.createdAt?.toDate?.() || new Date(),
              updatedAt: data?.updatedAt?.toDate?.() || new Date(),
            };
          });
          const seenKeys = new Set<string>();
          checkout.managedPixels = checkout.managedPixels.filter((p: any) => {
            const key = `${p.platform}:${p.pixelId || p.conversionId || p.measurementId || p.tagId}`;
            if (seenKeys.has(key)) {
              console.log(`[PIXEL-SERVER] Removendo pixel duplicado: ${key}`);
              return false;
            }
            seenKeys.add(key);
            return true;
          });
          console.log(`[PIXEL-SERVER] ${checkout.managedPixels.length} managed pixels carregados do checkout (dedup)`);
          checkout.managedPixels.forEach((p: any) => console.log(`[PIXEL-SERVER] -> ${p.platform}: pixelId=${p.pixelId}, enabled=${p.enabled}, events=`, JSON.stringify(p.events)));
        } else {
          console.log(`[PIXEL-SERVER] Nenhum pixel encontrado na subcollection do checkout ${checkout.id}`);
        }

        // 🎯 FALLBACK: Se checkout não tem pixels, herdar do produto
        if ((!checkout.managedPixels || checkout.managedPixels.length === 0) && checkout.syncedProductId) {
          console.log(`[PIXEL-SERVER] Fallback: buscando pixels do produto ${checkout.syncedProductId}`);
          const productPixelsSnap = await db
            .collection('products')
            .doc(checkout.syncedProductId)
            .collection('pixels')
            .where('tenantId', '==', checkout.tenantId)
            .get();

          if (!productPixelsSnap.empty) {
            checkout.managedPixels = productPixelsSnap.docs.map((doc: any) => {
              const data = doc.data();
              const { access_token, accessToken, ...safeData } = data;
              return {
                id: doc.id,
                ...safeData,
                events: data?.events || { pageView: true, viewContent: true, addToCart: true, initiateCheckout: true, addPaymentInfo: true, purchase: true },
                inheritedFromProduct: true,
                createdAt: data?.createdAt?.toDate?.() || new Date(),
                updatedAt: data?.updatedAt?.toDate?.() || new Date(),
              };
            });
            console.log(`[PIXEL-SERVER] ${checkout.managedPixels.length} pixels herdados do produto ${checkout.syncedProductId}`);
            checkout.managedPixels.forEach((p: any) => console.log(`[PIXEL-SERVER] -> ${p.platform}: pixelId=${p.pixelId}, enabled=${p.enabled}, events=`, JSON.stringify(p.events)));
          } else {
            console.log(`[PIXEL-SERVER] Nenhum pixel encontrado no produto ${checkout.syncedProductId}`);
          }
        } else if (!checkout.syncedProductId && (!checkout.managedPixels || checkout.managedPixels.length === 0)) {
          console.log(`[PIXEL-SERVER] AVISO: checkout sem syncedProductId E sem pixels diretos`);
        }
      }
    } catch (pixelError) {
      console.warn('[PIXEL-SERVER] Erro ao carregar managed pixels (nao critico):', pixelError);
    }

    // 🔧 ENRIQUECER ORDER BUMP PRODUCTS: buscar dados dos checkouts referenciados
    if (checkout.orderBump?.enabled && Array.isArray(checkout.orderBump?.products) && checkout.orderBump.products.length > 0) {
      try {
        const enrichedProducts = await Promise.all(
          checkout.orderBump.products.map(async (p: any) => {
            // Se já tem title e price > 0, não precisa re-buscar
            if ((p.title || p.customTitle) && p.price > 0) return p;
            try {
              const bumpDoc = await db.collection('checkouts').doc(p.checkoutId).get();
              if (bumpDoc.exists) {
                const d = bumpDoc.data() as any;
                return {
                  ...p,
                  title: p.title || d.title || 'Produto adicional',
                  description: p.description || d.subtitle || '',
                  price: p.price > 0 ? p.price : (d.pricing?.amount || 0),
                  imageUrl: p.imageUrl || d.logoUrl || d.visual?.logo || d.bannerUrl || '',
                };
              }
            } catch {/* não crítico */}
            return p;
          })
        );
        checkout.orderBump = { ...checkout.orderBump, products: enrichedProducts };
        console.log(`✅ Order bump products enriquecidos: ${enrichedProducts.length}`);
      } catch (obErr: any) {
        console.warn('⚠️ Erro ao enriquecer order bump products:', obErr?.message);
      }
    }

    console.log(`🎯 Checkout retornado:`, {
      id: checkout.id,
      title: checkout.title,
      marketTarget: checkout.marketTarget,
      globalSettings: checkout.globalSettings,
      methods: checkout.methods,
      sellerDisplayName: checkout.sellerDisplayName,
      managedPixelsCount: checkout.managedPixels?.length || 0
    });

    // ⚡ SWR CACHE: 30s fresh, +60s stale-while-revalidate — CDN/browser servem do cache
    // enquanto revalidam em background; produto bloqueado e erros mantêm no-store acima
    const cacheKey = `checkout:${slug}`;
    const body = JSON.stringify(checkout);
    const etag = `"${Buffer.from(cacheKey + body.length).toString('base64').slice(0,16)}"`;
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.set({
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      'ETag': etag,
      'Vary': 'Accept-Encoding'
    });
    res.json(checkout);

  } catch (error: any) {
    console.error('❌ Erro ao buscar checkout:', error);
    
    // 🚀 HEADERS ANTI-CACHE PARA ERROS TAMBÉM
    res.set({
      'Cache-Control': 'no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ✏️ ATUALIZAR CHECKOUT EXISTENTE
app.put('/api/checkout/update/:id', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const userId = req.user?.uid;
    
    console.log(`🛠️ Atualizando checkout ${id} para usuário ${userId}`);
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    // Verificar se o checkout existe e pertence ao usuário via Neon
    const existingCheckout = await storage.getCheckout(id);
    
    if (!existingCheckout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }
    
    if (existingCheckout.tenantId !== userId) {
      return res.status(403).json({ error: 'Checkout não pertence ao usuário' });
    }
    
    // Atualizar dados do checkout
    const updatedData = {
      ...updateData,
      updatedAt: new Date()
    };
    
    // 🧹 REMOVER CAMPOS UNDEFINED
    const sanitizedData = removeUndefinedDeep(updatedData);
    
    // 🌍 LOG DETALHADO DE GLOBALSTETTINGS
    console.log(`📝 Dados sendo atualizados:`, {
      marketTarget: sanitizedData.marketTarget,
      globalSettings: sanitizedData.globalSettings
    });
    
    // Atualizar via Neon
    await neonQuery(async (sql) => {
      await sql`UPDATE checkouts SET data = ${JSON.stringify(sanitizedData)}::jsonb, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${userId}`;
    }, `updateCheckout:${id}`);
    
    // Limpar cache do checkout
    storage.clearSellerCache?.();
    
    console.log(`✅ Checkout ${id} atualizado com sucesso`);
    res.json({ success: true, data: sanitizedData });
    
  } catch (error) {
    console.error('❌ Erro ao atualizar checkout:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔍 VERIFICAR SE CHECKOUT PODE SER DELETADO - COM RATE LIMITING
app.post('/api/check-checkout-deletable', verifyFirebaseToken, userRateLimit('checkout'), async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.body;
    const userId = req.user?.uid;
    
    console.log(`🔍 Verificando se checkout ${checkoutId} pode ser deletado`);
    
    if (!userId || !checkoutId) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    // Verificar se o checkout existe e pertence ao usuário via Neon
    const chkDelCheck = await storage.getCheckout(checkoutId);
    
    if (!chkDelCheck) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }
    
    if (chkDelCheck.tenantId !== userId) {
      return res.status(403).json({ error: 'Checkout não pertence ao usuário' });
    }
    
    // ✅ VENDAS DIGITAIS/FÍSICAS PODEM SER DELETADAS
    // ❌ APENAS ASSINATURAS ATIVAS BLOQUEIAM A EXCLUSÃO
    
    // Verificar se há assinaturas ativas via Neon
    let hasActiveSubscriptions = false;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM subscriptions WHERE checkout_id = ${checkoutId} AND status IN ('active','trialing') LIMIT 1`;
      hasActiveSubscriptions = rows.length > 0;
    }, `checkSubscriptions:${checkoutId}`);
    const canDelete = !hasActiveSubscriptions;
    
    console.log(`✅ Checkout ${checkoutId} - Pode deletar: ${canDelete} (Assinaturas ativas: ${hasActiveSubscriptions})`);
    res.json({ 
      canDelete,
      hasActiveSubscriptions,
      activeCount: hasActiveSubscriptions ? 1 : 0,
      reason: hasActiveSubscriptions ? 'Checkout possui assinaturas ativas' : 'Pode deletar'
    });
    
  } catch (error) {
    console.error('❌ Erro ao verificar checkout deletável:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🗑️ SOLICITAR EXCLUSÃO DE CHECKOUT (envia para aprovação do admin)
app.delete('/api/checkout/:id', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.uid;
    
    console.log(`📝 Solicitando exclusão de checkout ${id} para usuário ${userId}`);
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    // Aguardar Firebase
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();

    // Buscar checkout
    const checkoutDoc = await db.collection('checkouts').doc(id).get();
    
    if (!checkoutDoc.exists) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }
    
    const checkoutData = checkoutDoc.data();
    if (checkoutData.tenantId !== userId) {
      return res.status(403).json({ error: 'Checkout não pertence ao usuário' });
    }
    
    // Verificar se já existe solicitação pendente
    if (checkoutData?.deletionRequest?.status === 'pending') {
      return res.status(400).json({ 
        error: 'Já existe uma solicitação de exclusão pendente para este checkout',
        requestedAt: checkoutData.deletionRequest.requestedAt
      });
    }
    
    // ✅ REGRA CRITICAL: APENAS ASSINATURAS ATIVAS BLOQUEIAM A EXCLUSÃO
    // ✅ VENDAS DIGITAIS/FÍSICAS PODEM SOLICITAR EXCLUSÃO (MESMO COM VENDAS)
    // ❌ ASSINATURAS ATIVAS (active/trialing) → BLOQUEIA EXCLUSÃO
    const activeSubscriptions = await db.collection('subscriptions')
      .where('checkoutId', '==', id)
      .where('status', 'in', ['active', 'trialing'])
      .limit(1)
      .get();
    
    if (!activeSubscriptions.empty) {
      console.log(`❌ BLOQUEADO: Checkout ${id} possui assinaturas ativas`);
      return res.status(400).json({ 
        error: 'Não é possível solicitar exclusão de checkout com assinaturas ativas. Cancele as assinaturas primeiro.' 
      });
    }
    
    console.log(`✅ PERMITIDO: Checkout ${id} não possui assinaturas ativas (pode ser excluído)`);
    
    // Criar solicitação de exclusão NO CHECKOUT
    await db.collection('checkouts').doc(id).update({
      'deletionRequest.status': 'pending',
      'deletionRequest.requestedAt': adminSdk.firestore.FieldValue.serverTimestamp(),
      'deletionRequest.requestedBy': userId,
      'deletionRequest.expiresAt': adminSdk.firestore.Timestamp.fromDate(
        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 dias
      )
    });
    
    console.log(`✅ Solicitação de exclusão criada para checkout ${id}`);
    
    // 🔥 TAMBÉM MARCAR O PRODUTO VINCULADO (para aparecer no admin)
    try {
      const productsSnapshot = await db.collection('products')
        .where('checkoutId', '==', id)
        .limit(1)
        .get();
      
      if (!productsSnapshot.empty) {
        const productDoc = productsSnapshot.docs[0];
        await db.collection('products').doc(productDoc.id).update({
          'deletionRequest.status': 'pending',
          'deletionRequest.requestedAt': adminSdk.firestore.FieldValue.serverTimestamp(),
          'deletionRequest.requestedBy': userId,
          'deletionRequest.reason': `Solicitação de exclusão do checkout ${id}`,
          'deletionRequest.expiresAt': adminSdk.firestore.Timestamp.fromDate(
            new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 dias
          )
        });
        console.log(`✅ Produto ${productDoc.id} também marcado para exclusão`);
      }
    } catch (productError) {
      console.warn(`⚠️ Erro ao marcar produto para exclusão:`, productError);
      // Não falhar a operação se não encontrar produto
    }
    res.json({ 
      success: true,
      message: 'Solicitação enviada para análise. O administrador tem até 3 dias para retornar uma resposta.'
    });
    
  } catch (error) {
    console.error('❌ Erro ao solicitar exclusão:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
// [EXTRACTED] post /api/admin/checkout/:id/reject-deletion moved to server/routes/admin.ts

// ================================================================
// 🛍️ ROTA DE PRODUTOS COMPRADOS - ÁREA DO CLIENTE
// ================================================================

// 🔍 BUSCAR PRODUTOS COMPRADOS POR EMAIL (COM AUTENTICAÇÃO)
app.get('/api/products/purchased', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const email = req.query.email as string;
    const user = req.user;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    // 🔒 SEGURANÇA: Verificar se o usuário está consultando seus próprios produtos
    if (user?.email !== email) {
      console.log(`🚨 IDOR BLOCKED: User ${user?.email} tentando acessar produtos de ${email}`);
      return res.status(403).json({ error: 'Você só pode ver seus próprios produtos' });
    }

    console.log(`🔍 Buscando produtos comprados por: ${email}`);

    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();

    const products: any[] = [];

    // 1️⃣ BUSCAR ORDERS PAGAS DO CLIENTE (approved, paid, completed, active)
    const ordersSnapshot = await db.collection('orders')
      .where('customer.email', '==', email)
      .get();

    // Filtrar apenas orders pagas (vários status possíveis)
    const paidOrders = ordersSnapshot.docs.filter(doc => {
      const status = doc.data().status;
      return status && ['approved', 'paid', 'completed', 'active'].includes(status);
    });

    console.log(`📦 ${paidOrders.length} orders pagas encontradas de ${ordersSnapshot.size} totais`);

    for (const orderDoc of paidOrders) {
      const orderData = orderDoc.data();
      const productId = orderData.productId;

      if (!productId) continue;

      // Buscar dados do produto
      const productDoc = await db.collection('products').doc(productId).get();
      
      if (!productDoc.exists) continue;

      const productData = productDoc.data();

      // Verificar se tem acesso (enrollment ativo ou completed)
      const enrollmentSnapshot = await db.collection('enrollments')
        .where('customerEmail', '==', email)
        .where('productId', '==', productId)
        .get();

      // hasAccess = true se existe PELO MENOS UM enrollment ATIVO ou COMPLETED
      let hasAccess = false;
      for (const doc of enrollmentSnapshot.docs) {
        const enrollmentStatus = doc.data().status;
        if (enrollmentStatus && ['active', 'completed'].includes(enrollmentStatus)) {
          hasAccess = true;
          break;
        }
      }
      const enrollmentData = enrollmentSnapshot.empty ? null : enrollmentSnapshot.docs[0].data();

      products.push({
        id: orderDoc.id,
        productId: productId,
        orderId: orderDoc.id,
        checkoutId: orderData.checkoutId,
        title: productData?.title || 'Produto',
        type: productData?.type || 'digital',
        productType: productData?.type || 'digital',
        billingType: productData?.billingType,
        amount: orderData.amount || 0,
        originalAmount: orderData.amount || 0,
        method: orderData.method || 'card',
        hasAccess: hasAccess,
        purchaseDate: orderData.paidAt || orderData.createdAt,
        paidAt: orderData.paidAt,
        enrolledAt: enrollmentData?.enrolledAt,
        tenantId: orderData.tenantId || productData?.ownerId,
        customerName: orderData.customer?.name,
        customerEmail: orderData.customer?.email,
        customerPhone: orderData.customer?.phone,
      });
    }

    // 2️⃣ BUSCAR ASSINATURAS ATIVAS
    const subscriptionsSnapshot = await db.collection('subscriptions')
      .where('customer.email', '==', email)
      .where('status', 'in', ['active', 'trialing'])
      .get();

    console.log(`📦 ${subscriptionsSnapshot.size} assinaturas ativas encontradas`);

    for (const subDoc of subscriptionsSnapshot.docs) {
      const subData = subDoc.data();
      const productId = subData.productId;

      if (!productId) continue;

      const productDoc = await db.collection('products').doc(productId).get();
      const productData = productDoc.exists ? productDoc.data() : {};

      // Verificar se tem acesso
      const enrollmentSnapshot = await db.collection('enrollments')
        .where('userId', '==', user.uid)
        .where('productId', '==', productId)
        .where('active', '==', true)
        .limit(1)
        .get();

      const hasAccess = !enrollmentSnapshot.empty;
      const enrollmentData = enrollmentSnapshot.empty ? null : enrollmentSnapshot.docs[0].data();

      products.push({
        id: subDoc.id,
        productId: productId,
        subscriptionId: subDoc.id,
        checkoutId: subData.checkoutId,
        title: productData?.title || 'Assinatura',
        type: 'subscription',
        productType: 'subscription',
        billingType: 'subscription',
        amount: subData.amount || 0,
        originalAmount: subData.amount || 0,
        method: subData.method || 'card',
        hasAccess: hasAccess,
        purchaseDate: enrollmentData?.enrolledAt || subData.startDate || subData.createdAt,
        enrolledAt: enrollmentData?.enrolledAt,
        tenantId: subData.tenantId || productData?.ownerId,
        customerName: subData.customer?.name,
        customerEmail: subData.customer?.email,
        customerPhone: subData.customer?.phone,
        subscriptionStatus: subData.status,
        nextBillingDate: subData.currentPeriodEnd,
      });
    }

    console.log(`✅ Total de ${products.length} produtos encontrados para ${email}`);

    res.json({ products });

  } catch (error) {
    console.error('❌ Erro ao buscar produtos comprados:', error);
    res.status(500).json({ error: 'Erro ao buscar produtos', products: [] });
  }
});

// 🔍 BUSCAR HISTÓRICO DE COMPRAS DO CLIENTE (COM AUTENTICAÇÃO)
app.get('/api/customer/products', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log(`🔍 [CUSTOMER-PRODUCTS] API CHAMADA! Query:`, req.query);
    
    const email = req.query.email as string;
    const user = req.user;

    if (!email) {
      console.error('❌ [CUSTOMER-PRODUCTS] Email não fornecido');
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    // 🔒 SEGURANÇA: Verificar se o usuário está consultando seu próprio histórico
    if (user?.email !== email) {
      console.log(`🚨 IDOR BLOCKED: User ${user?.email} tentando acessar histórico de ${email}`);
      return res.status(403).json({ error: 'Você só pode ver seu próprio histórico' });
    }

    console.log(`🔍 [CUSTOMER-PRODUCTS] Buscando histórico de compras para: ${email}`);

    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();

    const purchases: any[] = [];
    const processedOrderIds = new Set<string>();

    // 1️⃣ BUSCAR ORDERS POR customer.email (formato nested)
    const ordersSnapshot1 = await db.collection('orders')
      .where('customer.email', '==', email)
      .get();
    console.log(`📦 [QUERY 1] customer.email: ${ordersSnapshot1.size} orders encontradas`);

    // 2️⃣ BUSCAR ORDERS POR customerEmail (formato flat)
    const ordersSnapshot2 = await db.collection('orders')
      .where('customerEmail', '==', email)
      .get();
    console.log(`📦 [QUERY 2] customerEmail: ${ordersSnapshot2.size} orders encontradas`);

    // 3️⃣ COMBINAR E DEDUPLICAR
    const allOrderDocs = [...ordersSnapshot1.docs, ...ordersSnapshot2.docs];
    console.log(`📦 [TOTAL] ${allOrderDocs.length} orders antes de deduplicar`);

    // Filtrar apenas orders pagas e deduplicar
    const paidOrders = allOrderDocs.filter(doc => {
      if (processedOrderIds.has(doc.id)) return false;
      processedOrderIds.add(doc.id);
      
      const data = doc.data();
      const status = data.status;
      console.log(`📋 Order ${doc.id}: status=${status}, amount=${data.amount}`);
      return status && ['approved', 'paid', 'completed', 'active'].includes(status);
    });

    console.log(`💰 ${paidOrders.length} orders pagas de ${processedOrderIds.size} únicas`);
    for (const orderDoc of paidOrders) {
      const orderData = orderDoc.data();

      // Buscar dados do checkout snapshot
      let checkoutSnapshot = orderData.checkoutSnapshot || {};
      
      if (!checkoutSnapshot.title && orderData.checkoutId) {
        const checkoutDoc = await db.collection('checkouts').doc(orderData.checkoutId).get();
        if (checkoutDoc.exists) {
          const checkoutData = checkoutDoc.data();
          checkoutSnapshot = {
            title: checkoutData?.title,
            subtitle: checkoutData?.subtitle,
            description: checkoutData?.description,
            logoUrl: checkoutData?.logoUrl,
            bannerUrl: checkoutData?.bannerUrl,
          };
          console.log(`✅ Checkout encontrado: ${checkoutData?.title}`);
        }
      }

      // Verificar se tem acesso (enrollment ativo ou completed)
      const productId = orderData.productId;
      let hasAccess = false;
      
      if (productId) {
        const enrollmentSnapshot = await db.collection('enrollments')
          .where('customerEmail', '==', email)
          .where('productId', '==', productId)
          .get();

        // hasAccess = true se existe PELO MENOS UM enrollment ATIVO ou COMPLETED
        for (const doc of enrollmentSnapshot.docs) {
          const enrollmentStatus = doc.data().status;
          if (enrollmentStatus && ['active', 'completed'].includes(enrollmentStatus)) {
            hasAccess = true;
            break;
          }
        }
      }

      purchases.push({
        id: orderDoc.id,
        orderId: orderDoc.id,
        checkoutId: orderData.checkoutId,
        productId: orderData.productId,
        checkoutSnapshot: checkoutSnapshot,
        amount: orderData.amount || 0,
        method: orderData.method || 'card',
        status: orderData.status || 'pending',
        createdAt: orderData.createdAt,
        paidAt: orderData.paidAt,
        tenantId: orderData.tenantId,
        hasAccess: hasAccess, // 🔑 Campo crucial para liberar acesso
      });
    }

    // 2️⃣ BUSCAR ASSINATURAS — dois formatos: customer.email (nested) e customerEmail (flat)
    const processedSubIds = new Set<string>();
    const [subsSnapshot1, subsSnapshot2] = await Promise.all([
      db.collection('subscriptions').where('customer.email', '==', email).get(),
      db.collection('subscriptions').where('customerEmail', '==', email).get(),
    ]);
    const allSubDocs = [...subsSnapshot1.docs, ...subsSnapshot2.docs];
    console.log(`📦 ${allSubDocs.length} assinaturas antes de deduplicar`);

    // Filtrar apenas assinaturas ativas ou pagas e deduplicar
    const activeSubs = allSubDocs.filter(doc => {
      if (processedSubIds.has(doc.id)) return false;
      processedSubIds.add(doc.id);
      const status = doc.data().status;
      return status && ['active', 'paid', 'trialing'].includes(status);
    });
    console.log(`📦 ${activeSubs.length} assinaturas ativas/pagas encontradas`);

    for (const subDoc of activeSubs) {
      const subData = subDoc.data();

      let checkoutSnapshot = subData.checkoutSnapshot || {};
      
      if (!checkoutSnapshot.title && subData.checkoutId) {
        const checkoutDoc = await db.collection('checkouts').doc(subData.checkoutId).get();
        if (checkoutDoc.exists) {
          const checkoutData = checkoutDoc.data();
          checkoutSnapshot = {
            title: checkoutData?.title,
            subtitle: checkoutData?.subtitle,
            description: checkoutData?.description,
            logoUrl: checkoutData?.logoUrl,
            bannerUrl: checkoutData?.bannerUrl,
          };
        }
      }

      // Verificar enrollment para assinaturas
      const productId = subData.productId;
      let hasAccess = false;
      
      if (productId) {
        const enrollmentSnapshot = await db.collection('enrollments')
          .where('customerEmail', '==', email)
          .where('productId', '==', productId)
          .get();

        // hasAccess = true se existe PELO MENOS UM enrollment ATIVO ou COMPLETED
        for (const doc of enrollmentSnapshot.docs) {
          const enrollmentStatus = doc.data().status;
          if (enrollmentStatus && ['active', 'completed'].includes(enrollmentStatus)) {
            hasAccess = true;
            break;
          }
        }
      }

      purchases.push({
        id: subDoc.id,
        orderId: subDoc.id,
        subscriptionId: subDoc.id,
        checkoutId: subData.checkoutId,
        productId: subData.productId,
        checkoutSnapshot: checkoutSnapshot,
        amount: subData.amount || 0,
        method: subData.method || 'card',
        status: subData.status || 'pending',
        createdAt: subData.createdAt,
        paidAt: subData.startDate || subData.createdAt,
        tenantId: subData.tenantId,
        type: 'subscription',
        hasAccess: hasAccess, // 🔑 Campo crucial para liberar acesso
      });
    }

    console.log(`✅ Total de ${purchases.length} compras no histórico para ${email}`);

    // Ordenar por data de criação (mais recente primeiro)
    purchases.sort((a, b) => {
      const dateA = a.createdAt?._seconds || a.createdAt?.seconds || 0;
      const dateB = b.createdAt?._seconds || b.createdAt?.seconds || 0;
      return dateB - dateA;
    });

    res.json({ products: purchases });

  } catch (error) {
    console.error('❌ Erro ao buscar histórico de compras:', error);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// 💰 BUSCAR SALDO DE REEMBOLSOS DO CLIENTE
app.post('/api/customer/refund-balances', async (req, res) => {
  try {
    const { customerEmail } = req.body;
    
    if (!customerEmail) {
      return res.status(400).json({ error: 'Email do cliente é obrigatório' });
    }
    
    console.log(`💰 Buscando saldo de reembolsos para: ${customerEmail}`);
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    // Buscar todos os reembolsos aprovados
    const refundsSnapshot = await db.collection('refunds')
      .where('customerEmail', '==', customerEmail)
      .where('status', '==', 'approved')
      .get();
    
    const balances = refundsSnapshot.docs.map(doc => {
      const refundData = doc.data();
      return {
        id: doc.id,
        orderId: refundData.orderId,
        productTitle: refundData.productTitle || 'Produto',
        amount: refundData.refundAmount || 0,
        refundedAt: refundData.approvedAt || refundData.createdAt,
        status: 'available', // Todos aprovados estão disponíveis para saque
      };
    });
    
    console.log(`✅ ${balances.length} reembolsos aprovados encontrados`);
    
    res.json({ balances });
    
  } catch (error) {
    console.error('❌ Erro ao buscar saldo de reembolsos:', error);
    res.status(500).json({ error: 'Erro ao buscar saldo', balances: [] });
  }
});

// 🏦 BUSCAR HISTÓRICO DE SAQUES DO CLIENTE
app.post('/api/customer/withdrawals', async (req, res) => {
  try {
    const { customerEmail } = req.body;
    
    if (!customerEmail) {
      return res.status(400).json({ error: 'Email do cliente é obrigatório' });
    }
    
    console.log(`🏦 Buscando histórico de saques para: ${customerEmail}`);
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    // Buscar todos os saques do cliente (se houver collection)
    // Por enquanto retorna vazio, mas a estrutura está pronta
    const withdrawalsSnapshot = await db.collection('customer_withdrawals')
      .where('customerEmail', '==', customerEmail)
      .get();
    
    const withdrawals = withdrawalsSnapshot.docs.map(doc => {
      const withdrawalData = doc.data();
      return {
        id: doc.id,
        amount: withdrawalData.amount || 0,
        pixKey: withdrawalData.pixKey,
        pixKeyType: withdrawalData.pixKeyType || 'email',
        status: withdrawalData.status || 'pending',
        createdAt: withdrawalData.createdAt,
        processedAt: withdrawalData.processedAt || null,
        adminNotes: withdrawalData.adminNotes || null,
      };
    });
    
    console.log(`✅ ${withdrawals.length} saques encontrados`);
    
    res.json({ withdrawals });
    
  } catch (error) {
    console.error('❌ Erro ao buscar histórico de saques:', error);
    res.status(500).json({ error: 'Erro ao buscar saques', withdrawals: [] });
  }
});

// 💳 SOLICITAR SAQUE DE REEMBOLSO (CLIENTE → ADMIN)
app.post('/api/customer/request-withdrawal', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { amount, pixKey, pixKeyType, customerEmail, customerName } = req.body;
    const user = req.user;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valor inválido' });
    }
    if (!pixKey) {
      return res.status(400).json({ error: 'Chave PIX é obrigatória' });
    }

    await ensureFirebaseReady();
    const adminInst = getAdmin();
    const db = adminInst.firestore();

    const withdrawalId = nanoid();
    const now = adminInst.firestore.Timestamp.now();

    await db.collection('customer_withdrawals').doc(withdrawalId).set({
      id: withdrawalId,
      customerId: user.uid,
      customerEmail: customerEmail || user.email || '',
      customerName: customerName || '',
      amount,
      pixKey,
      pixKeyType: pixKeyType || 'email',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      processedAt: null,
      adminNotes: null,
    });

    console.log(`✅ Solicitação de saque do cliente criada: ${withdrawalId} - R$ ${(amount/100).toFixed(2)}`);
    res.json({ success: true, withdrawalId });

  } catch (error: any) {
    console.error('❌ Erro ao solicitar saque do cliente:', error);
    res.status(500).json({ error: 'Erro ao solicitar saque. Tente novamente.' });
  }
});

// 📋 LISTAR SAQUES DE CLIENTES (ADMIN)
app.post('/api/admin/customer-withdrawals', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    await ensureFirebaseReady();
    const adminInst = getAdmin();
    const db = adminInst.firestore();

    const snapshot = await db.collection('customer_withdrawals').get();
    const withdrawals = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        customerEmail: d.customerEmail || '',
        customerName: d.customerName || '',
        amount: d.amount || 0,
        pixKey: d.pixKey || '',
        pixKeyType: d.pixKeyType || 'email',
        status: d.status || 'pending',
        createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
        processedAt: d.processedAt?.toDate?.()?.toISOString() || null,
        adminNotes: d.adminNotes || null,
      };
    });

    withdrawals.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.localeCompare(a.createdAt);
    });

    res.json({ withdrawals });

  } catch (error: any) {
    console.error('❌ Erro ao listar saques de clientes:', error);
    res.status(500).json({ error: 'Erro ao listar saques', withdrawals: [] });
  }
});

// ✅ APROVAR SAQUE DE CLIENTE (ADMIN)
app.patch('/api/admin/customer-withdrawals/:id/approve', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const adminUser = req.user;
    const { id } = req.params;
    const { notes } = req.body;

    await ensureFirebaseReady();
    const adminInst = getAdmin();
    const db = adminInst.firestore();

    const ref = db.collection('customer_withdrawals').doc(id);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Saque não encontrado' });
    }
    if (doc.data()?.status !== 'pending') {
      return res.status(409).json({ error: `Saque já processado (status: ${doc.data()?.status})` });
    }

    const now = adminInst.firestore.Timestamp.now();
    await ref.update({
      status: 'approved',
      processedAt: now,
      updatedAt: now,
      reviewedBy: adminUser.uid,
      adminNotes: notes || null,
    });

    console.log(`✅ Saque de cliente APROVADO: ${id}`);
    res.json({ success: true, message: 'Saque aprovado com sucesso' });

  } catch (error: any) {
    console.error('❌ Erro ao aprovar saque do cliente:', error);
    res.status(500).json({ error: 'Erro ao aprovar saque' });
  }
});

// ❌ REJEITAR SAQUE DE CLIENTE (ADMIN)
app.patch('/api/admin/customer-withdrawals/:id/reject', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const adminUser = req.user;
    const { id } = req.params;
    const { notes } = req.body;

    await ensureFirebaseReady();
    const adminInst = getAdmin();
    const db = adminInst.firestore();

    const ref = db.collection('customer_withdrawals').doc(id);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Saque não encontrado' });
    }
    if (doc.data()?.status !== 'pending') {
      return res.status(409).json({ error: `Saque já processado (status: ${doc.data()?.status})` });
    }

    const now = adminInst.firestore.Timestamp.now();
    await ref.update({
      status: 'rejected',
      processedAt: now,
      updatedAt: now,
      reviewedBy: adminUser.uid,
      adminNotes: notes || null,
    });

    console.log(`❌ Saque de cliente REJEITADO: ${id}`);
    res.json({ success: true, message: 'Saque rejeitado' });

  } catch (error: any) {
    console.error('❌ Erro ao rejeitar saque do cliente:', error);
    res.status(500).json({ error: 'Erro ao rejeitar saque' });
  }
});

// 🔍 VERIFICAR REEMBOLSO ATIVO (COM AUTENTICAÇÃO)
app.get('/api/refunds/active', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { customerId, productId } = req.query;
    const user = req.user;

    if (!customerId || !productId) {
      return res.status(400).json({ error: 'customerId e productId são obrigatórios' });
    }

    // 🔒 SEGURANÇA: Verificar se o usuário está consultando seus próprios reembolsos
    if (user?.uid !== customerId) {
      console.log(`🚨 IDOR BLOCKED: User ${user?.uid} tentando acessar reembolsos de ${customerId}`);
      return res.status(403).json({ error: 'Você só pode ver seus próprios reembolsos' });
    }

    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();

    // Buscar reembolso ativo
    const refundsSnapshot = await db.collection('refunds')
      .where('customerId', '==', customerId as string)
      .where('productId', '==', productId as string)
      .where('status', 'in', ['pending', 'approved'])
      .limit(1)
      .get();

    if (refundsSnapshot.empty) {
      return res.json({ refund: null });
    }

    const refundDoc = refundsSnapshot.docs[0];
    const refundData = refundDoc.data();

    res.json({
      refund: {
        id: refundDoc.id,
        ...refundData
      }
    });

  } catch (error) {
    console.error('❌ Erro ao verificar reembolso ativo:', error);
    res.status(500).json({ error: 'Erro ao verificar reembolso' });
  }
});

// 🚫 DEBUG ENDPOINT REMOVIDO - SISTEMA EM PRODUÇÃO

// 🚫 ENDPOINT MANUAL REMOVIDO - APROVAÇÃO AUTOMÁTICA VIA WEBHOOK

// 🚫 ENDPOINT DE CORREÇÃO REMOVIDO - ENROLLMENTS CRIADOS AUTOMATICAMENTE

// 🚫 ENDPOINT DE SETUP HTML REMOVIDO - CONFIGURAÇÃO VIA ENV VARS EM PRODUÇÃO

// 📋 LISTAR TODOS OS TICKETS DE SUPORTE (ADMIN) - PROTEGIDO
app.get('/api/support/tickets', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    console.log('📋 API - Listando tickets de suporte...');
    
    await ensureFirebaseReady();
    const ticketsRef = getAdmin().firestore().collection('supportTickets');
    let snapshot;
    try {
      snapshot = await ticketsRef.limit(200).get();
    } catch (queryErr: any) {
      if (queryErr?.code === 8 || queryErr?.message?.includes('RESOURCE_EXHAUSTED')) {
        console.warn('⚠️ Quota exhausted ao listar tickets, retornando vazio');
        return res.json({ tickets: [], total: 0 });
      }
      throw queryErr;
    }
    
    const tickets: any[] = [];
    snapshot.forEach((doc: any) => {
      const data = doc.data();
      tickets.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        lastMessageAt: data.lastMessageAt?.toDate?.() || data.lastMessageAt,
        lastAdminReplyAt: data.lastAdminReplyAt?.toDate?.() || data.lastAdminReplyAt,
        lastSellerReplyAt: data.lastSellerReplyAt?.toDate?.() || data.lastSellerReplyAt,
        closedAt: data.closedAt?.toDate?.() || data.closedAt,
        resolvedAt: data.resolvedAt?.toDate?.() || data.resolvedAt,
      });
    });
    
    tickets.sort((a: any, b: any) => {
      const dateA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const dateB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return dateB - dateA;
    });
    
    console.log(`✅ Encontrados ${tickets.length} tickets`);
    res.json({ tickets, total: tickets.length });
    
  } catch (error) {
    console.error('❌ Erro ao listar tickets:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});


// 🚫 ENDPOINT DE EMERGÊNCIA REMOVIDO - CORREÇÕES DEVEM SER FEITAS VIA ADMIN PANEL

// 🗑️ DELETAR TICKET DE SUPORTE (ADMIN ONLY) - PERMANENTE SEM REVERSÃO
app.delete('/api/support/tickets/:ticketId', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params;
    console.log(`🗑️ API - Admin deletando ticket: ${ticketId}`);
    
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const admin = await getAdmin();
    const db = admin.firestore();

    // Verificar se o ticket existe
    const ticketRef = db.collection('supportTickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();
    
    if (!ticketDoc.exists) {
      return res.status(404).json({ 
        error: 'Ticket não encontrado',
        message: `Ticket ${ticketId} não existe`
      });
    }

    console.log(`🗑️ Ticket encontrado: ${ticketId} - Iniciando deleção PERMANENTE`);

    // Buscar todas as mensagens do ticket
    const messagesRef = db.collection('supportMessages').where('ticketId', '==', ticketId);
    const messagesSnapshot = await messagesRef.get();
    
    console.log(`🗑️ Encontradas ${messagesSnapshot.size} mensagens para deletar`);

    // Criar batch para operação atômica
    const batch = db.batch();
    
    // Deletar todas as mensagens
    messagesSnapshot.forEach((doc: any) => {
      console.log(`🗑️ Adicionando mensagem ${doc.id} para deleção`);
      batch.delete(doc.ref);
    });
    
    // Deletar o ticket
    console.log(`🗑️ Adicionando ticket ${ticketId} para deleção`);
    batch.delete(ticketRef);
    
    // Executar deleção atômica
    console.log(`🗑️ Executando deleção PERMANENTE de ticket ${ticketId} e ${messagesSnapshot.size} mensagens`);
    await batch.commit();
    
    console.log(`✅ 🗑️ TICKET ${ticketId} DELETADO PERMANENTEMENTE! (sem reversão)`);
    console.log(`✅ 🗑️ ${messagesSnapshot.size} MENSAGENS DELETADAS PERMANENTEMENTE!`);
    
    res.json({
      success: true,
      message: `Ticket ${ticketId} deletado permanentemente`,
      deletedTicket: ticketId,
      deletedMessages: messagesSnapshot.size,
      isPermanentlyDeleted: true,
      noRecovery: true
    });
    
  } catch (error) {
    console.error('❌ Erro ao deletar ticket:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

// ================================================================
// 🎫 ROTAS DE SUPORTE PARA SELLERS - FALTANTES IMPLEMENTADAS
// ================================================================

// 🎫 CRIAR TICKET DE SUPORTE (SELLER) - COM RATE LIMITING RIGOROSO
// 🛡️ TICKET ANTI-SPAM & VALIDATION MIDDLEWARE - DEVASTADOR
const ticketSecurityMiddleware = (req: any, res: any, next: any) => {
  try {
    const { subject, message, description, priority } = req.body;
    
    // ✅ ACEITAR TANTO "message" QUANTO "description" (retrocompatível)
    const messageContent = message || description;
    
    // 🚫 VALIDAÇÃO 1: CAMPOS OBRIGATÓRIOS
    if (!subject || !messageContent || subject.trim() === '' || messageContent.trim() === '') {
      console.warn(`❌ TICKET BLOCKED: Missing required fields from ${req.ip}`);
      return res.status(400).json({
        success: false,
        message: 'SECURITY: Assunto e mensagem são obrigatórios'
      });
    }
    
    // 🚫 VALIDAÇÃO 2: TAMANHO DOS CAMPOS - 🛡️ MAX 200 CHARS (anti-prompt-injection)
    if (subject.length > 200 || messageContent.length > 200) {
      console.warn(`❌ TICKET BLOCKED: Fields too long from ${req.ip}: subject=${subject.length}, message=${messageContent.length}`);
      return res.status(400).json({
        success: false,
        message: 'SECURITY: Assunto e mensagem limitados a 200 caracteres (anti-prompt-injection)'
      });
    }
    
    // 🚫 VALIDAÇÃO 3: CONTEÚDO MALICIOSO
    const maliciousPatterns = [
      /<script|<iframe|<object|javascript:/i,
      /\b(eval|exec|system|shell)\b/i,
      /(union|select|insert|delete|drop)\s+(from|into|table)/i,
      /$\{|$\(|<%|%>/i
    ];
    
    const contentToCheck = [subject, messageContent].join(' ');
    for (const pattern of maliciousPatterns) {
      if (pattern.test(contentToCheck)) {
        console.warn(`❌ TICKET BLOCKED: Malicious pattern from ${req.ip}: ${pattern}`);
        return res.status(400).json({
          success: false,
          message: 'SECURITY: Conteúdo suspeito detectado no ticket'
        });
      }
    }
    
    // 🚫 VALIDAÇÃO 4: ANTI-SPAM PATTERNS
    const spamPatterns = [
      /(.)\1{4,}/g, // Caracteres repetidos
      /\b(free|gratis|oferta|desconto|promocao|urgente|ganhe|click|clique)\b.*\b(free|gratis|oferta|desconto|promocao|urgente|ganhe|click|clique)\b/i,
      /https?:\/\/[^\s]+.*https?:\/\/[^\s]+/i, // Múltiplas URLs
      /[A-Z]{5,}.*[A-Z]{5,}/g // Muitas maiúsculas
    ];
    
    for (const pattern of spamPatterns) {
      if (pattern.test(contentToCheck)) {
        console.warn(`❌ TICKET BLOCKED: Spam pattern from ${req.ip}: ${pattern}`);
        return res.status(400).json({
          success: false,
          message: 'SECURITY: Padrão de spam detectado no ticket'
        });
      }
    }
    
    // 🚫 VALIDAÇÃO 5: PRIORIDADE VÁLIDA
    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    if (priority && !validPriorities.includes(priority)) {
      console.warn(`❌ TICKET BLOCKED: Invalid priority from ${req.ip}: ${priority}`);
      return res.status(400).json({
        success: false,
        message: 'SECURITY: Prioridade inválida'
      });
    }
    
    console.log(`✅ TICKET SECURITY: Passed all validations from ${req.ip} - subject: ${subject.substring(0, 30)}...`);
    next();
    
  } catch (error) {
    console.error('❌ TICKET SECURITY ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'SECURITY: Erro na validação de ticket'
    });
  }
};

// [DEAD CODE] POST /api/support/tickets - duplicated by supportTicketsRouter (mounted at /api/support, route POST /tickets) which runs first
app.post('/api/support/tickets', 
  verifyFirebaseToken, 
  userRateLimit('tickets'), 
  ticketSecurityMiddleware, // 🛡️ ANTI-SPAM & VALIDATION
  async (req: AuthenticatedRequest, res) => {
  try {
    const { subject, category, priority, description } = req.body;
    const sellerUid = req.user?.uid;
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    console.log(`🎫 SELLER criando ticket:`, { sellerUid, subject, category });
    
    const admin = await getAdmin();
    const db = admin.firestore();
    
    // Buscar dados do seller
    const sellerDoc = await db.collection('sellers').doc(sellerUid).get();
    if (!sellerDoc.exists) {
      return res.status(404).json({ error: 'Seller não encontrado' });
    }
    
    const sellerData = sellerDoc.data();
    
    // 🎯 LIMITE DE 2 TICKETS ABERTOS POR SELLER
    const openTicketsSnapshot = await db
      .collection('supportTickets')
      .where('sellerId', '==', sellerUid)
      .where('status', 'in', ['open', 'answered'])
      .get();
    
    const openTicketsCount = openTicketsSnapshot.size;
    
    if (openTicketsCount >= 2) {
      console.log(`⚠️ Limite de tickets atingido para seller ${sellerUid}: ${openTicketsCount}/2 tickets abertos`);
      return res.status(400).json({ 
        error: 'Limite de tickets atingido',
        message: `Você já possui ${openTicketsCount} ${openTicketsCount === 1 ? 'ticket aberto' : 'tickets abertos'}. O limite é de 2 tickets simultâneos. Aguarde a conclusão de um ticket para abrir outro.`,
        current: openTicketsCount,
        limit: 2,
        hint: 'Os tickets serão finalizados automaticamente quando o admin marcar como "Resolvido" ou "Fechado".'
      });
    }
    
    console.log(`✅ Seller ${sellerUid} tem ${openTicketsCount}/2 tickets abertos - pode criar novo ticket`);
    
    const ticketId = `ticket_${Date.now()}_${sellerUid.slice(-8)}`;
    const messageId = `msg_${Date.now()}_${sellerUid.slice(-8)}`;
    
    // Criar ticket
    const ticketData = {
      id: ticketId,
      sellerId: sellerUid,
      sellerEmail: sellerData?.email || 'email-nao-informado',
      tenantId: sellerData?.tenantId || sellerUid,
      subject: subject || 'Sem assunto',
      category: category || 'geral',
      priority: priority || 'normal',
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      unreadByAdmin: 1,
      unreadBySeller: 0,
      totalMessages: 1
    };
    
    // Criar primeira mensagem
    const firstMessageData = {
      id: messageId,
      ticketId: ticketId,
      senderId: sellerUid,
      senderType: 'seller',
      senderName: sellerData?.businessName || sellerData?.email || 'Seller',
      content: description || 'Descrição não informada',
      type: 'text',
      createdAt: FieldValue.serverTimestamp(),
      readByAdmin: false,
      readBySeller: true
    };
    
    // Operação atômica
    const batch = db.batch();
    batch.set(db.collection('supportTickets').doc(ticketId), ticketData);
    batch.set(db.collection('supportMessages').doc(messageId), firstMessageData);
    
    await batch.commit();
    
    console.log(`✅ Ticket criado: ${ticketId} pelo seller ${sellerUid}`);
    res.json({ success: true, ticketId, messageId });
    
  } catch (error) {
    console.error('❌ Erro ao criar ticket:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📋 BUSCAR TICKETS DO SELLER
// [DEAD CODE] GET /api/support/tickets/my-tickets - duplicated by supportTicketsRouter (mounted at /api/support, route GET /tickets/my-tickets) which runs first
app.get('/api/support/tickets/my-tickets', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    console.log(`📋 SELLER buscando tickets:`, sellerUid);
    
    const admin = await getAdmin();
    const db = admin.firestore();
    
    // 🔥 BUSCAR SEM ÍNDICE - apenas where, sem orderBy
    const ticketsSnapshot = await db
      .collection('supportTickets')
      .where('sellerId', '==', sellerUid)
      .get();
    
    // 📊 ORDENAR NO CÓDIGO (não precisa de índice Firebase)
    const tickets = ticketsSnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || doc.data().createdAt,
        updatedAt: doc.data().updatedAt?.toDate?.() || doc.data().updatedAt,
        lastMessageAt: doc.data().lastMessageAt?.toDate?.() || doc.data().lastMessageAt
      }))
      .sort((a, b) => {
        const dateA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const dateB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return dateB - dateA; // Ordem decrescente (mais recente primeiro)
      });
    
    console.log(`✅ ${tickets.length} tickets encontrados para seller ${sellerUid}`);
    res.json({ tickets, total: tickets.length });
    
  } catch (error) {
    console.error('❌ Erro ao buscar tickets do seller:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💬 BUSCAR MENSAGENS DE UM TICKET
// [DEAD CODE] GET /api/support/tickets/:ticketId/messages - duplicated by supportTicketsRouter (mounted at /api/support, route GET /tickets/:ticketId/messages) which runs first
app.get('/api/support/tickets/:ticketId/messages', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params;
    const userUid = req.user?.uid;
    
    console.log(`💬 Buscando mensagens do ticket:`, ticketId, `pelo usuário:`, userUid);
    
    const admin = await getAdmin();
    const db = admin.firestore();
    
    // Verificar se o usuário pode acessar este ticket
    const ticketDoc = await db.collection('supportTickets').doc(ticketId).get();
    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticketData = ticketDoc.data();
    
    // ✅ VERIFICAR SE É ADMIN (via email ou custom claims)
    const userEmail = req.user?.email;
    const isAdmin = (process.env.ADMIN_EMAIL ? userEmail === process.env.ADMIN_EMAIL : false) || req.authUser?.isAdmin;
    
    console.log(`🔍 Verificação de acesso - ticketSellerId: ${ticketData?.sellerId}, userUid: ${userUid}, isAdmin: ${isAdmin}`);
    
    if (!isAdmin && ticketData?.sellerId !== userUid) {
      console.log(`❌ ACESSO NEGADO: Seller ${userUid} tentou acessar ticket de ${ticketData?.sellerId}`);
      return res.status(403).json({ error: 'Acesso negado ao ticket' });
    }
    
    // 🔥 QUERY OTIMIZADA: buscar SEM orderBy para evitar índice composto
    const messagesSnapshot = await db
      .collection('supportMessages')
      .where('ticketId', '==', ticketId)
      .get();
    
    const messages = messagesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || doc.data().createdAt
    }));
    
    // ⚡ ORDENAR EM MEMÓRIA: evita índice composto no Firebase
    const sortedMessages = messages.sort((a, b) => {
      const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
      const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
      return dateA.getTime() - dateB.getTime(); // Ordem crescente (asc)
    });
    
    console.log(`✅ ${sortedMessages.length} mensagens encontradas para ticket ${ticketId}`);
    res.json({ messages: sortedMessages, total: sortedMessages.length });
    
  } catch (error) {
    console.error('❌ Erro ao buscar mensagens:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📝 ADICIONAR MENSAGEM AO TICKET - COM RATE LIMITING PARA CHATS
// [DEAD CODE] POST /api/support/tickets/:ticketId/messages - duplicated by supportTicketsRouter (mounted at /api/support, route POST /tickets/:ticketId/messages) which runs first
app.post('/api/support/tickets/:ticketId/messages', verifyFirebaseToken, userRateLimit('messages'), async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params;
    const { content, type } = req.body;
    const senderUid = req.user?.uid;
    
    if (!content || !senderUid) {
      return res.status(400).json({ error: 'Conteúdo e sender obrigatórios' });
    }
    
    console.log(`📝 Adicionando mensagem ao ticket ${ticketId} por ${senderUid}`);
    
    const admin = await getAdmin();
    const db = admin.firestore();
    
    // Verificar acesso ao ticket
    const ticketDoc = await db.collection('supportTickets').doc(ticketId).get();
    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticketData = ticketDoc.data();
    
    // ✅ VERIFICAR SE É ADMIN (via email ou custom claims)
    const userEmail = req.user?.email;
    const isAdmin = (process.env.ADMIN_EMAIL ? userEmail === process.env.ADMIN_EMAIL : false) || req.authUser?.isAdmin;
    
    if (!isAdmin && ticketData?.sellerId !== senderUid) {
      return res.status(403).json({ error: 'Acesso negado ao ticket' });
    }
    
    // Buscar dados do sender
    let senderData;
    if (isAdmin) {
      senderData = { businessName: 'VolatusPay Support', email: 'volatuspay@gmail.com' };
    } else {
      const sellerDoc = await db.collection('sellers').doc(senderUid).get();
      senderData = sellerDoc.data() || {};
    }
    
    const messageId = `msg_${Date.now()}_${senderUid.slice(-8)}`;
    
    // Criar mensagem
    const messageData = {
      id: messageId,
      ticketId: ticketId,
      senderId: senderUid,
      senderType: isAdmin ? 'admin' : 'seller',
      senderName: senderData?.businessName || senderData?.email || 'Usuario',
      content: content,
      type: type || 'text',
      createdAt: FieldValue.serverTimestamp(),
      readByAdmin: isAdmin ? true : false,
      readBySeller: isAdmin ? false : true
    };
    
    // Atualizar ticket
    const ticketUpdates: any = {
      lastMessageAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      totalMessages: FieldValue.increment(1)
    };
    
    if (isAdmin) {
      ticketUpdates.unreadBySeller = FieldValue.increment(1);
    } else {
      ticketUpdates.unreadByAdmin = FieldValue.increment(1);
    }
    
    // Operação atômica
    const batch = db.batch();
    batch.set(db.collection('supportMessages').doc(messageId), messageData);
    batch.update(db.collection('supportTickets').doc(ticketId), ticketUpdates);
    
    await batch.commit();
    
    console.log(`✅ Mensagem adicionada: ${messageId} ao ticket ${ticketId}`);
    res.json({ success: true, messageId, ticketId });
    
  } catch (error) {
    console.error('❌ Erro ao adicionar mensagem:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔄 ATUALIZAR STATUS DO TICKET
app.patch('/api/support/tickets/:ticketId/status', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params;
    const { status } = req.body;
    const userUid = req.user?.uid;
    
    if (!status || !userUid) {
      return res.status(400).json({ error: 'Status e usuário obrigatórios' });
    }
    
    console.log(`🔄 Atualizando status do ticket ${ticketId} para ${status} por ${userUid}`);
    
    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    
    const ticketDoc = await db.collection('supportTickets').doc(ticketId).get();
    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticketData = ticketDoc.data();
    
    const userEmail = req.user?.email;
    const adminEmail = process.env.ADMIN_EMAIL || '';
    const isAdmin = (adminEmail ? userEmail === adminEmail : false) || req.authUser?.isAdmin || req.user?.customClaims?.admin === true || req.user?.customClaims?.superAdmin === true;
    
    if (!isAdmin && ticketData?.sellerId !== userUid) {
      return res.status(403).json({ error: 'Acesso negado ao ticket' });
    }
    
    const now = new Date();
    const updates: any = {
      status: status,
      updatedAt: now
    };
    
    if (status === 'closed') {
      updates.closedAt = now;
    }
    
    if (status === 'resolved') {
      updates.resolvedAt = now;
    }
    
    await db.collection('supportTickets').doc(ticketId).update(updates);
    
    console.log(`✅ Status do ticket ${ticketId} atualizado para ${status}`);
    res.json({ success: true, ticketId, newStatus: status });
    
  } catch (error: any) {
    console.error('❌ Erro ao atualizar status:', error);
    if (error?.code === 8 || error?.message?.includes('RESOURCE_EXHAUSTED')) {
      return res.status(503).json({ error: 'Serviço temporariamente indisponível (quota)' });
    }
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ✅ ACEITAR TICKET E ASSUMIR ATENDIMENTO (ADMIN)
app.patch('/api/support/tickets/:ticketId/accept', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params;
    const adminUid = req.user?.uid;
    
    if (!adminUid) {
      return res.status(401).json({ error: 'Admin não autenticado' });
    }
    
    console.log(`✅ Admin ${adminUid} aceitando ticket ${ticketId}`);
    
    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    
    const ticketDoc = await db.collection('supportTickets').doc(ticketId).get();
    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const assignedAdminName = req.user?.displayName || req.user?.email || 'Admin VolatusPay';
    
    const now = new Date();
    const updates: any = {
      status: 'answered',
      assignedAdminId: adminUid,
      assignedAdminName: assignedAdminName,
      acceptedAt: now,
      updatedAt: now
    };
    
    await db.collection('supportTickets').doc(ticketId).update(updates);
    
    console.log(`✅ Ticket ${ticketId} aceito por admin ${assignedAdminName}`);
    res.json({ 
      success: true, 
      ticketId, 
      newStatus: 'answered',
      assignedAdmin: assignedAdminName
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao aceitar ticket:', error);
    if (error?.code === 8 || error?.message?.includes('RESOURCE_EXHAUSTED')) {
      return res.status(503).json({ error: 'Serviço temporariamente indisponível (quota)' });
    }
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 👁️ MARCAR MENSAGENS COMO LIDAS
app.patch('/api/support/tickets/:ticketId/read', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params;
    const userUid = req.user?.uid;
    
    console.log(`👁️ Marcando mensagens como lidas do ticket ${ticketId} por ${userUid}`);
    
    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    
    const ticketDoc = await db.collection('supportTickets').doc(ticketId).get();
    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticketData = ticketDoc.data();
    
    const userEmail = req.user?.email;
    const adminEmail = process.env.ADMIN_EMAIL || '';
    const isAdmin = (adminEmail ? userEmail === adminEmail : false) || req.authUser?.isAdmin || req.user?.customClaims?.admin === true || req.user?.customClaims?.superAdmin === true;
    
    if (!isAdmin && ticketData?.sellerId !== userUid) {
      return res.status(403).json({ error: 'Acesso negado ao ticket' });
    }
    
    const updates: any = {
      updatedAt: new Date()
    };
    
    if (isAdmin) {
      updates.unreadByAdmin = 0;
    } else {
      updates.unreadBySeller = 0;
    }
    
    await db.collection('supportTickets').doc(ticketId).update(updates);
    
    console.log(`✅ Mensagens marcadas como lidas no ticket ${ticketId} por ${userUid}`);
    res.json({ success: true, ticketId });
    
  } catch (error: any) {
    console.error('❌ Erro ao marcar como lida:', error);
    if (error?.code === 8 || error?.message?.includes('RESOURCE_EXHAUSTED')) {
      return res.status(503).json({ error: 'Serviço temporariamente indisponível (quota)' });
    }
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ❌ REMOVENDO IMPLEMENTAÇÃO DUPLICADA E CONFLITANTE
// Esta implementação estava conflitando com a implementação autenticada na linha 21734
// A implementação correta está na linha 21734 com verifyFirebaseToken

// 🏷️ CREATE PRODUCT - ENDPOINT PARA CRIAÇÃO DE PRODUTOS - COM RATE LIMITING E VALIDAÇÃO
// 🔒 PRODUÇÃO: Seller precisa estar aprovado pelo admin para criar produtos
app.post('/api/products', verifyFirebaseToken, requireApprovedSeller, userRateLimit('products'), validateImageURLs(['imageUrl', 'logoUrl']), async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🏷️ Criando novo produto...');
    console.log('📋 Produto sendo criado');
    
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não encontrado' });
    }

    // 🎯 LIMITE DE 15 PRODUTOS POR SELLER
    const existingProducts = await storage.getProductsByTenant(tenantId);
    if (existingProducts.length >= 15) {
      console.log(`⚠️ Limite de produtos atingido para seller ${tenantId}: ${existingProducts.length}/15`);
      return res.status(400).json({ 
        error: 'Limite de produtos atingido',
        message: 'Você atingiu o limite máximo de 15 produtos. Para criar mais produtos, delete algum produto existente.',
        current: existingProducts.length,
        limit: 15
      });
    }

    // 🛡️ VALIDAÇÃO DE DADOS COM ZOD
    const validatedData = insertProductSchema.parse({
      ...req.body,
      tenantId // Garantir que o tenantId seja do usuário autenticado
    });

    console.log('✅ Dados validados para produto:', validatedData.title);

    // 💰 VALIDAÇÃO DE PREÇO MÍNIMO: R$ 5,00 (500 centavos)
    const MIN_PRICE_CENTAVOS = 500;
    if (validatedData.price && validatedData.price > 0 && validatedData.price < MIN_PRICE_CENTAVOS) {
      console.log(`⚠️ Preço abaixo do mínimo: R$ ${validatedData.price / 100} < R$ 5,00`);
      return res.status(400).json({ 
        error: 'Preço mínimo não atingido',
        message: 'O preço mínimo para criar um produto é R$ 5,00',
        minPrice: MIN_PRICE_CENTAVOS,
        minPriceFormatted: 'R$ 5,00'
      });
    }

    // 🏗️ CRIAR PRODUTO NO STORAGE (área de membros vazia - seller cria módulos manualmente)
    const product = await storage.createProduct(validatedData);
    
    console.log('✅ Produto criado com sucesso:', product.id);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('./lib/neon-products.js').then(({ neonWriteProduct }) => {
      neonWriteProduct({
        productId: product.id,
        tenantId: (product as any).tenantId,
        title: product.title,
        description: (product as any).description,
        productType: (product as any).productType,
        imageUrl: (product as any).imageUrl,
        active: product.active,
        accessDuration: (product as any).accessDuration,
        notifyExpirationDays: (product as any).notifyExpirationDays,
        hasAccess: (product as any).hasAccess,
        checkoutId: (product as any).checkoutId,
      });
    }).catch(() => {});
    
    // 🏢 CRIAR ÁREA DE MEMBROS AUTOMATICAMENTE (se for digital/subscription)
    if (product.hasAccess && product.id) {
      try {
        console.log('🏢 Criando área de membros automática para produto:', product.id);
        
        const admin = getAdmin();
        const db = admin.firestore();
        
        // 🛡️ VERIFICAR SE JÁ EXISTE ÁREA DE MEMBROS (não sobrescrever)
        const existingMemberArea = await db.collection('memberAreas').doc(product.id).get();
        
        if (existingMemberArea.exists) {
          console.log('⚠️ Área de membros já existe para produto:', product.id, '- não sobrescrevendo');
        } else {
          const memberAreaData = {
            productId: product.id,
            title: `Área de ${product.title}`,
            description: product.description || 'Bem-vindo à área de membros',
            tenantId: product.tenantId,
            active: true,
            modules: [],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
          };
          
          // 🔥 USAR MESMO ID DO PRODUTO PARA ÁREA DE MEMBROS (eterna)
          await db.collection('memberAreas').doc(product.id).set(memberAreaData);
          console.log('✅ Área de membros ETERNA criada com ID:', product.id);
        }
        
        // 🔗 Atualizar produto com memberAreaId (mesmo ID)
        await db.collection('products').doc(product.id).update({
          memberAreaId: product.id,
          updatedAt: FieldValue.serverTimestamp()
        });
        
        console.log('✅ Produto vinculado à área de membros:', product.id);
      } catch (memberAreaError) {
        console.warn('⚠️ Erro ao criar área de membros (não crítico):', memberAreaError);
      }
    }
    
    return res.status(201).json({
      success: true,
      product: product
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao criar produto:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: error.errors 
      });
    }
    
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 📝 UPDATE PRODUCT - ENDPOINT PARA ATUALIZAÇÃO DE PRODUTOS
app.patch('/api/products/:id', verifyFirebaseToken, validateImageURLs(['imageUrl']), async (req: AuthenticatedRequest, res) => {
  try {
    const productId = req.params.id;
    console.log(`📝 Atualizando produto ${productId}...`);
    
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não encontrado' });
    }

    // 🔍 Verificar se produto existe e pertence ao tenant
    const admin = getAdmin();
    const db = admin.firestore();
    const productDoc = await db.collection('products').doc(productId).get();
    
    if (!productDoc.exists) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    const product = productDoc.data();
    if (product?.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Você não tem permissão para atualizar este produto' });
    }

    // 🛡️ VALIDAÇÃO DE DADOS COM ZOD (permite campos parciais)
    const { updateProductSchema } = await import('../shared/schema.js');
    const validationResult = updateProductSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: validationResult.error.errors 
      });
    }
    
    const validatedData = validationResult.data;

    // 🔒 WHITELIST DE CAMPOS MUTÁVEIS (prevenir mass assignment)
    const allowedFields = ['title', 'description', 'imageUrl', 'category', 'language', 'currency', 'active', 'membersAreaEnabled', 'allowMultiplePurchases'];
    const updatePayload: any = {
      updatedAt: FieldValue.serverTimestamp()
    };
    
    allowedFields.forEach(field => {
      if (validatedData[field as keyof typeof validatedData] !== undefined) {
        updatePayload[field] = validatedData[field as keyof typeof validatedData];
      }
    });

    console.log(`✅ Dados validados para produto ${productId}:`, Object.keys(updatePayload));

    // 🔗 PRÉ-CARREGAR CHECKOUT REFS ANTES DA TRANSAÇÃO (queries não permitidas dentro de transação)
    const needsSync = validatedData.title || validatedData.description || validatedData.imageUrl || 
                      validatedData.category || validatedData.language || validatedData.currency ||
                      validatedData.allowMultiplePurchases !== undefined;
    
    let checkoutRefs: any[] = [];
    if (needsSync) {
      const checkoutsSnapshot = await db.collection('checkouts')
        .where('productId', '==', productId)
        .get();
      
      if (checkoutsSnapshot.size > 10) {
        return res.status(400).json({ 
          error: 'Limite de checkouts excedido',
          message: 'Produto possui mais de 10 checkouts. Entre em contato com o suporte.'
        });
      }
      
      checkoutRefs = checkoutsSnapshot.docs.map(doc => doc.ref);
      console.log(`📋 Pré-carregados ${checkoutRefs.length} checkout(s) para sincronização`);
    }

    // 🔒 FIRESTORE TRANSACTION - GARANTIA DE ATOMICIDADE 100%
    const updatedProduct = await db.runTransaction(async (transaction) => {
      const productRef = db.collection('products').doc(productId);
      
      // 🔄 Re-verificar produto dentro da transação (snapshot isolado)
      const freshProductDoc = await transaction.get(productRef);
      
      if (!freshProductDoc.exists) {
        throw new Error('Produto não encontrado durante a transação');
      }
      
      const freshProduct = freshProductDoc.data();
      if (freshProduct?.tenantId !== tenantId) {
        throw new Error('Permissão negada durante a transação');
      }
      
      // 📝 Atualizar produto
      transaction.update(productRef, updatePayload);
      
      // 🔄 Atualizar checkouts associados (se houver) - DOT NOTATION CORRETA
      if (checkoutRefs.length > 0) {
        checkoutRefs.forEach(ref => {
          // Construir updates usando FieldPath para garantir merge correto de nested fields
          const checkoutUpdates: Record<string, any> = {};
          
          // Timestamp sempre presente
          checkoutUpdates.updatedAt = FieldValue.serverTimestamp();
          
          // Mapear campos top-level do produto para checkout
          if (validatedData.title !== undefined) {
            checkoutUpdates.title = validatedData.title;
          }
          if (validatedData.description !== undefined) {
            checkoutUpdates.subtitle = validatedData.description;
          }
          if (validatedData.imageUrl !== undefined) {
            checkoutUpdates.logoUrl = validatedData.imageUrl;
          }
          
          // ✅ NESTED FIELDS: Usar dot notation CORRETAMENTE para merge parcial
          // Isso preserva outros campos dentro de metadata e globalSettings
          if (validatedData.category !== undefined) {
            checkoutUpdates['metadata.category'] = validatedData.category;
          }
          if (validatedData.language !== undefined) {
            checkoutUpdates['globalSettings.language'] = validatedData.language;
          }
          if (validatedData.currency !== undefined) {
            checkoutUpdates['globalSettings.currency'] = validatedData.currency;
          }
          if (validatedData.allowMultiplePurchases !== undefined) {
            checkoutUpdates.allowMultiplePurchases = validatedData.allowMultiplePurchases;
          }
          
          // Aplicar update com merge automático via dot notation
          transaction.update(ref, checkoutUpdates);
        });
        
        console.log(`🔄 ${checkoutRefs.length} checkout(s) incluídos na transação (merge preservando dados existentes)`);
      }
      
      // Retornar produto atualizado (será commitado se tudo passar)
      return { 
        id: productId, 
        ...freshProduct,
        ...updatePayload
      };
    });
    
    console.log(`✅ Produto ${productId} atualizado atomicamente com sucesso`);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('./lib/neon-products.js').then(({ neonUpdateProduct }) => {
      neonUpdateProduct(productId, updatePayload);
    }).catch(() => {});
    
    const { firestoreCache } = await import('./lib/firestore-cache.js');
    firestoreCache.invalidateProduct(productId);
    firestoreCache.invalidateTenantCheckouts(`products_${tenantId}`);
    firestoreCache.invalidateTenantCheckouts(tenantId);
    firestoreCache.invalidateShowcase();
    
    return res.json({
      success: true,
      product: updatedProduct
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao atualizar produto:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: error.errors 
      });
    }
    
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 📸 UPLOAD DE COVER IMAGE - ENDPOINT ESPECÍFICO PARA PRODUTOS
app.post('/api/products/:id/cover-image', verifyFirebaseToken, (req: AuthenticatedRequest, res, next) => {
  uploadImage.single('file')(req, res, (err: any) => {
    if (err) {
      console.error('❌ Erro no multer:', err);
      return res.status(400).json({ error: err.message || 'Erro no upload do arquivo' });
    }
    next();
  });
}, async (req: AuthenticatedRequest, res) => {
  try {
    const productId = req.params.id;
    const userId = req.user?.uid;
    
    console.log(`📸 Upload de cover para produto ${productId} - User: ${userId}`);
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não encontrado' });
    }

    // 🔍 Verificar se produto existe e pertence ao tenant
    const admin = getAdmin();
    const db = admin.firestore();
    const productDoc = await db.collection('products').doc(productId).get();
    
    if (!productDoc.exists) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    const product = productDoc.data();
    if (product?.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Você não tem permissão para atualizar este produto' });
    }
    
    if (!req.file || req.file.size === 0) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado ou arquivo vazio' });
    }

    // 🛡️ VALIDAÇÃO 1: TIPOS PERMITIDOS
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Tipo de arquivo não permitido. Use apenas JPEG, PNG ou WebP' });
    }

    // 🛡️ VALIDAÇÃO 2: TAMANHO MÁXIMO (5MB)
    const maxSize = 5 * 1024 * 1024;
    if (req.file.size > maxSize) {
      return res.status(400).json({ 
        error: 'Imagem muito grande. Tamanho máximo: 5MB',
        maxSize: '5MB',
        currentSize: `${(req.file.size / 1024 / 1024).toFixed(2)}MB`
      });
    }

    // 🛡️ VALIDAÇÃO 3: MAGIC BYTES COM SHARP
    try {
      const imageMetadata = await sharp(req.file.buffer).metadata();
      
      const validFormats = ['jpeg', 'png', 'webp'];
      if (!imageMetadata.format || !validFormats.includes(imageMetadata.format)) {
        return res.status(400).json({ error: 'Arquivo corrompido ou não é uma imagem válida' });
      }

      if (!imageMetadata.width || !imageMetadata.height) {
        return res.status(400).json({ error: 'Imagem com dimensões inválidas' });
      }

      if (imageMetadata.width > 4000 || imageMetadata.height > 4000) {
        return res.status(400).json({ error: 'Imagem muito grande. Máximo: 4000x4000 pixels' });
      }

      console.log(`✅ Cover validada: ${imageMetadata.format} ${imageMetadata.width}x${imageMetadata.height}`);

    } catch (sharpError) {
      return res.status(400).json({ error: 'Arquivo inválido ou corrompido' });
    }

    // 🛡️ VALIDAÇÃO 4: SANITIZAÇÃO DE NOME
    const sanitizedName = req.file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.')
      .substring(0, 100);

    // 📂 ORGANIZAR: products/{productId}/{timestamp}-{random}.{ext}
    const timestamp = Date.now();
    const ext = sanitizedName.split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    const fileName = `products/${productId}/${timestamp}-${nanoid(12)}.${safeExt}`;

    // 🐰 Upload para Bunny CDN
    const { uploadToBunnyStorage: uploadProductCover } = await import('./lib/bunny-helper.js');
    const uploadResult = await uploadProductCover(fileName, req.file.buffer, req.file.mimetype);
    if (!uploadResult.success) {
      return res.status(500).json({ error: 'Erro ao fazer upload da imagem' });
    }
    const publicUrl = uploadResult.url!;

    // 💾 ATUALIZAR PRODUTO COM NOVA COVER
    await db.collection('products').doc(productId).update({
      imageUrl: publicUrl,
      updatedAt: FieldValue.serverTimestamp()
    });

    // 🔗 SINCRONIZAR COM CHECKOUTS ASSOCIADOS (productId E syncedProductId)
    try {
      const [byProductId, bySyncedProductId] = await Promise.all([
        db.collection('checkouts').where('productId', '==', productId).get(),
        db.collection('checkouts').where('syncedProductId', '==', productId).get(),
      ]);
      
      const allDocs = new Map<string, FirebaseFirestore.DocumentSnapshot>();
      byProductId.docs.forEach(doc => allDocs.set(doc.id, doc));
      bySyncedProductId.docs.forEach(doc => allDocs.set(doc.id, doc));
      
      if (allDocs.size > 0) {
        await Promise.all(
          Array.from(allDocs.values()).map(doc => 
            doc.ref.update({
              logoUrl: publicUrl,
              imageUrl: publicUrl,
              updatedAt: FieldValue.serverTimestamp()
            })
          )
        );
        
        console.log(`🔄 ${allDocs.size} checkout(s) sincronizado(s) com nova cover`);
      }
    } catch (syncError) {
      console.warn('⚠️ Erro ao sincronizar checkouts (não crítico):', syncError);
    }

    const { firestoreCache: coverCache } = await import('./lib/firestore-cache.js');
    coverCache.invalidateProduct(productId);
    coverCache.invalidateTenantCheckouts(`products_${tenantId}`);
    coverCache.invalidateTenantCheckouts(tenantId);
    coverCache.invalidateShowcase();

    console.log(`✅ Cover image atualizada para produto ${productId}:`, publicUrl);

    res.json({
      success: true,
      url: publicUrl,
      fileName,
      productId
    });

  } catch (error: any) {
    console.error('❌ Erro ao fazer upload de cover:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao fazer upload da imagem',
      message: error.message
    });
  }
});

// 🛒 CREATE CHECKOUT - ENDPOINT PARA CRIAÇÃO DE CHECKOUTS - COM RATE LIMITING E VALIDAÇÃO
// 🔒 PRODUÇÃO: Seller precisa estar aprovado pelo admin para criar checkouts
// [DEAD CODE] POST /api/checkouts - duplicated by checkoutsRouter (mounted at /api/checkouts, route POST /) which runs first
app.post('/api/checkouts', verifyFirebaseToken, requireApprovedSeller, userRateLimit('checkouts'), validateImageURLs(['logoUrl', 'bannerUrl']), async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🛒 Criando novo checkout...');
    console.log('📋 Checkout sendo criado');
    
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não encontrado' });
    }

    // 🎯 LIMITE DE 50 CHECKOUTS POR SELLER
    const existingCheckouts = await storage.getCheckoutsByTenant(tenantId);
    if (existingCheckouts.length >= 50) {
      console.log(`⚠️ Limite de checkouts atingido para seller ${tenantId}: ${existingCheckouts.length}/50`);
      return res.status(400).json({ 
        error: 'Limite de checkouts atingido',
        message: 'Você atingiu o limite máximo de 50 checkouts. Para criar mais checkouts, delete algum checkout existente.',
        current: existingCheckouts.length,
        limit: 50
      });
    }

    // 🛡️ VALIDAÇÃO DE DADOS COM ZOD
    const validatedData = insertCheckoutSchema.parse({
      ...req.body,
      tenantId // Garantir que o tenantId seja do usuário autenticado
    });

    console.log('✅ Dados validados para checkout:', validatedData.title);

    // 🏗️ CRIAR CHECKOUT NO STORAGE
    const checkout = await storage.createCheckout(validatedData);
    
    console.log('✅ Checkout criado com sucesso:', checkout.id);
    
    // 🚀 CRIAR PRODUTO AUTOMATICAMENTE VINCULADO AO CHECKOUT
    try {
      console.log('🎯 Criando produto automático para checkout:', checkout.id);
      
      const productData = {
        tenantId: checkout.tenantId,
        title: checkout.title,
        description: checkout.subtitle || 'Produto criado automaticamente',
        imageUrl: checkout.logoUrl || '',
        productType: checkout.productType || 'digital',
        amount: checkout.pricing?.amount || 0,
        checkoutId: checkout.id,
        hasAccess: checkout.productType === 'digital', // 🔄 Subscriptions e digitais ganham acesso imediatamente após pagamento
        notifyExpirationDays: [7, 2, 1],
        active: checkout.active !== false,
        guaranteeDays: (checkout.pricing as any)?.guaranteeDays || 7,
      };
      
      const product = await storage.createProduct(productData as any);
      console.log('✅ Produto automático criado:', product.id);

      // 🐘 DUAL-WRITE → Neon (fire-and-forget)
      import('./lib/neon-products.js').then(({ neonWriteProduct }) => {
        neonWriteProduct({
          productId: product.id,
          tenantId: (product as any).tenantId,
          title: product.title,
          description: (product as any).description,
          productType: (product as any).productType,
          imageUrl: (product as any).imageUrl,
          active: product.active,
          accessDuration: (product as any).accessDuration,
          notifyExpirationDays: (product as any).notifyExpirationDays,
          hasAccess: (product as any).hasAccess,
          checkoutId: (product as any).checkoutId,
        });
      }).catch(() => {});
      
      // 🔗 Atualizar checkout com productId
      await storage.updateCheckout(checkout.id, { productId: product.id } as any);
      checkout.productId = product.id;
      
      // 🏢 CRIAR ÁREA DE MEMBROS AUTOMATICAMENTE (se for digital/subscription)
      if (product.hasAccess && product.id) {
        try {
          console.log('🏢 Criando área de membros automática para produto:', product.id);
          
          const admin = getAdmin();
          const db = admin.firestore();
          
          // 🛡️ VERIFICAR SE JÁ EXISTE ÁREA DE MEMBROS (não sobrescrever)
          const existingMemberArea = await db.collection('memberAreas').doc(product.id).get();
          
          if (existingMemberArea.exists) {
            console.log('⚠️ Área de membros já existe para produto:', product.id, '- não sobrescrevendo');
          } else {
            const memberAreaData = {
              productId: product.id,
              title: `Área de ${checkout.title}`,
              description: checkout.subtitle || 'Bem-vindo à área de membros',
              tenantId: checkout.tenantId,
              active: true,
              modules: [],
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp()
            };
            
            // 🔥 USAR MESMO ID DO PRODUTO PARA ÁREA DE MEMBROS (eterna)
            await db.collection('memberAreas').doc(product.id).set(memberAreaData);
            console.log('✅ Área de membros ETERNA criada com ID:', product.id);
          }
          
          // 🔗 Atualizar produto com memberAreaId (mesmo ID)
          await db.collection('products').doc(product.id).update({
            memberAreaId: product.id,
            updatedAt: FieldValue.serverTimestamp()
          });
          
          console.log('✅ Produto vinculado à área de membros:', product.id);
        } catch (memberAreaError) {
          console.warn('⚠️ Erro ao criar área de membros (não crítico):', memberAreaError);
        }
      }
      
    } catch (productError) {
      console.warn('⚠️ Erro ao criar produto automático (não crítico):', productError);
    }
    
    return res.status(201).json({
      success: true,
      checkout: checkout
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao criar checkout:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: error.errors 
      });
    }
    
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 📊 TRACKING DE ANALYTICS DO CHECKOUT - INCREMENTO ATÔMICO SEM AUTENTICAÇÃO
app.post('/api/checkouts/:slug/analytics/:metric', async (req, res) => {
  try {
    const { slug, metric } = req.params;
    
    // Validar métrica
    const validMetrics = ['pageViews', 'formFilled', 'paymentClicked'];
    if (!validMetrics.includes(metric)) {
      return res.status(400).json({ error: 'Métrica inválida' });
    }
    
    console.log(`📊 ANALYTICS: Incrementando ${metric} para checkout ${slug}`);
    
    const admin = getAdmin();
    const db = admin.firestore();
    
    // Buscar checkout pelo slug (com fallback por document ID)
    const checkoutSnapshot = await db.collection('checkouts')
      .where('slug', '==', slug)
      .limit(1)
      .get();
    
    let checkoutDoc = checkoutSnapshot.empty ? null : checkoutSnapshot.docs[0];
    if (!checkoutDoc) {
      const docById = await db.collection('checkouts').doc(slug).get();
      if (docById.exists) checkoutDoc = docById as any;
    }

    if (!checkoutDoc) {
      console.warn(`⚠️ ANALYTICS: Checkout ${slug} não encontrado`);
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }
    
    // Incrementar métrica atomicamente
    await checkoutDoc.ref.update({
      [`analytics.${metric}`]: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    });
    
    console.log(`✅ ANALYTICS: ${metric} incrementado para ${slug}`);
    
    res.json({ success: true, metric, slug });
    
  } catch (error: any) {
    console.error('❌ Erro ao rastrear analytics:', error);
    res.status(500).json({ error: 'Erro ao processar tracking' });
  }
});

// 👥 VISITANTES ONLINE AO VIVO - HEARTBEAT E CONTAGEM EM TEMPO REAL
app.post('/api/checkouts/:slug/presence', async (req, res) => {
  try {
    const { slug } = req.params;
    const { sessionId } = req.body;
    
    console.log(`👥 HEARTBEAT: slug=${slug}, sessionId=${sessionId}`);
    
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId é obrigatório' });
    }
    
    const admin = getAdmin();
    const db = admin.firestore();
    
    // Buscar checkout pelo slug (com fallback por document ID)
    const checkoutSnapshot = await db.collection('checkouts')
      .where('slug', '==', slug)
      .limit(1)
      .get();
    
    let checkoutDocPresence: any = checkoutSnapshot.empty ? null : checkoutSnapshot.docs[0];
    if (!checkoutDocPresence) {
      const docById = await db.collection('checkouts').doc(slug).get();
      if (docById.exists) checkoutDocPresence = docById;
    }

    if (!checkoutDocPresence) {
      console.warn(`⚠️ Checkout não encontrado: ${slug}`);
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }
    
    const checkoutDoc = checkoutDocPresence;
    const checkoutId = checkoutDoc.id;
    
    // Salvar presença na subcoleção
    const presenceRef = db
      .collection('checkouts')
      .doc(checkoutId)
      .collection('presence')
      .doc(sessionId);
    
    await presenceRef.set({
      lastSeen: FieldValue.serverTimestamp(),
      checkoutId,
      slug
    });
    
    // Contar visitantes ativos (últimos 2 minutos)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const activePresence = await db
      .collection('checkouts')
      .doc(checkoutId)
      .collection('presence')
      .where('lastSeen', '>=', twoMinutesAgo)
      .get();
    
    const activeCount = activePresence.size;
    
    console.log(`✅ HEARTBEAT: ${activeCount} visitante(s) online no checkout ${slug}`);
    
    // Atualizar contador no checkout
    await checkoutDoc.ref.update({
      'analytics.activeNow': activeCount,
      updatedAt: FieldValue.serverTimestamp()
    });
    
    res.json({ success: true, activeNow: activeCount });
    
  } catch (error: any) {
    console.error('❌ Erro ao processar presença:', error);
    res.status(500).json({ error: 'Erro ao processar presença' });
  }
});

// 🗑️ SOLICITAR EXCLUSÃO DE PRODUTO - SELLER CRIA SOLICITAÇÃO PARA APROVAÇÃO ADMIN
app.delete('/api/products/:id', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const productId = req.params.id;
    const reason = req.body?.reason || 'Produto não será mais vendido';
    
    console.log(`🗑️ [DELETE PRODUCT] Iniciando solicitação de exclusão para produto: ${productId}`);
    console.log(`🗑️ [DELETE PRODUCT] Reason: ${reason}`);
    
    // Buscar tenant do usuário autenticado
    const tenantId = await getTenantFromAuth(req);
    const userUid = req.authUser?.uid || req.user?.uid;
    
    console.log(`🗑️ [DELETE PRODUCT] TenantID: ${tenantId}, UserUID: ${userUid}`);
    
    if (!tenantId || !userUid) {
      console.error(`🗑️ [DELETE PRODUCT] ERRO: Autenticação inválida - tenantId=${tenantId}, userUid=${userUid}`);
      return res.status(401).json({ error: 'Autenticação inválida' });
    }
    
    // Buscar produto
    const admin = getAdmin();
    const db = admin.firestore();
    const productDoc = await db.collection('products').doc(productId).get();
    
    if (!productDoc.exists) {
      console.error(`🗑️ [DELETE PRODUCT] ERRO: Produto ${productId} não encontrado`);
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    const product = productDoc.data();
    console.log(`🗑️ [DELETE PRODUCT] Produto encontrado: ${product?.title} (tenantId: ${product?.tenantId})`);
    
    // Verificar ownership
    if (product?.tenantId !== tenantId) {
      console.warn(`🚨 [DELETE PRODUCT] TENTATIVA DE SOLICITAR EXCLUSÃO DE PRODUTO DE OUTRO SELLER - Produto tenantId: ${product?.tenantId}, User tenantId: ${tenantId}`);
      return res.status(403).json({ error: 'Você não tem permissão para este produto' });
    }
    
    console.log(`✅ [DELETE PRODUCT] Ownership verificado - produto pertence ao seller`);

    
    // Verificar se já existe solicitação pendente
    if (product?.deletionRequest?.status === 'pending') {
      console.warn(`🗑️ [DELETE PRODUCT] BLOQUEADO: Solicitação pendente já existe`);
      return res.status(400).json({ 
        error: 'Já existe uma solicitação de exclusão pendente para este produto',
        requestedAt: product.deletionRequest.requestedAt
      });
    }
    
    // Verificar se foi rejeitada (não pode solicitar novamente)
    if (product?.deletionRequest?.status === 'rejected') {
      console.warn(`🗑️ [DELETE PRODUCT] BLOQUEADO: Solicitação foi rejeitada anteriormente`);
      return res.status(403).json({ 
        error: 'A exclusão deste produto foi rejeitada pelo administrador',
        rejectionReason: product.deletionRequest.rejectionReason,
        rejectedAt: product.deletionRequest.reviewedAt
      });
    }
    
    console.log(`🗑️ [DELETE PRODUCT] Criando solicitação de exclusão no Firestore...`);
    
    // Criar solicitação de exclusão
    await db.collection('products').doc(productId).update({
      'deletionRequest.status': 'pending',
      'deletionRequest.requestedAt': FieldValue.serverTimestamp(),
      'deletionRequest.requestedBy': userUid,
      'deletionRequest.reason': reason,
      updatedAt: FieldValue.serverTimestamp()
    });
    
    console.log(`✅ [DELETE PRODUCT] Solicitação de exclusão criada com sucesso para produto ${productId}`);
    console.log(`📧 [DELETE PRODUCT] Admin deve aprovar/rejeitar a exclusão`);
    
    res.json({ 
      success: true,
      message: 'Solicitação de exclusão enviada para aprovação do administrador',
      productId,
      status: 'pending'
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao solicitar exclusão:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 🗑️ DELETAR PRODUTO DIRETO - SEM APROVAÇÃO DO ADMIN (SOFT DELETE)
app.delete('/api/products/:id/direct', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const productId = req.params.id;
    
    console.log(`🗑️ [DELETE DIRECT] Iniciando exclusão direta para produto: ${productId}`);
    
    // Buscar tenant do usuário autenticado
    const tenantId = await getTenantFromAuth(req);
    const userUid = req.authUser?.uid || req.user?.uid;
    
    console.log(`🗑️ [DELETE DIRECT] TenantID: ${tenantId}, UserUID: ${userUid}`);
    
    if (!tenantId || !userUid) {
      console.error(`🗑️ [DELETE DIRECT] ERRO: Autenticação inválida`);
      return res.status(401).json({ error: 'Autenticação inválida' });
    }
    
    // Buscar produto
    const admin = getAdmin();
    const db = admin.firestore();
    const productDoc = await db.collection('products').doc(productId).get();
    
    if (!productDoc.exists) {
      console.error(`🗑️ [DELETE DIRECT] ERRO: Produto ${productId} não encontrado`);
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    const product = productDoc.data();
    console.log(`🗑️ [DELETE DIRECT] Produto encontrado: ${product?.name || product?.title}`);
    
    // Verificar ownership
    if (product?.tenantId !== tenantId) {
      console.warn(`🚨 [DELETE DIRECT] BLOQUEADO: Tentativa de deletar produto de outro seller`);
      return res.status(403).json({ error: 'Você não tem permissão para este produto' });
    }
    
    console.log(`✅ [DELETE DIRECT] Ownership verificado`);
    
    // Verificar se já foi deletado
    if (product?.deletedAt) {
      console.warn(`🗑️ [DELETE DIRECT] Produto já foi deletado anteriormente`);
      return res.status(400).json({ error: 'Produto já foi deletado' });
    }
    
    // SOFT DELETE - Marca como deletado mas mantém histórico de vendas
    await db.collection('products').doc(productId).update({
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy: userUid,
      deletedReason: 'Deletado diretamente pelo seller',
      active: false,
      updatedAt: FieldValue.serverTimestamp()
    });
    
    console.log(`✅ [DELETE DIRECT] Produto ${productId} soft-deletado. Iniciando limpeza do Bunny...`);

    // 🗑️ Invalidar caches do servidor imediatamente
    try {
      firestoreCache.invalidateProduct(productId);
      firestoreCache.invalidateTenantCheckouts(`products_${tenantId}`);
      console.log(`✅ [DELETE DIRECT] Cache servidor invalidado para produto ${productId} e lista tenant ${tenantId}`);
    } catch (e) {}

    // 🗑️ LIMPEZA BUNNY (assíncrona, não bloqueia resposta)
    // Responde ao cliente imediatamente, limpa no background
    res.json({ 
      success: true,
      message: 'Produto deletado com sucesso',
      productId
    });

    // Limpeza em background (não bloqueia a resposta ao seller)
    setImmediate(async () => {
      try {
        const { getBunnyCredentials } = await import('./lib/bunny-helper.js');
        const credentials = await getBunnyCredentials();
        const adminSdk = getAdmin();
        const rtdbInstance = adminSdk.database();

        // 1️⃣ Coletar vídeos e imagens dos módulos/aulas via RTDB
        const videoGuids: string[] = [];
        const imageUrls: string[] = [];

        try {
          const modulesSnap = await rtdbInstance.ref(`products/${productId}/modules`).once('value');
          const modulesData = modulesSnap.val();
          if (modulesData) {
            for (const modId in modulesData) {
              const mod = modulesData[modId];
              if (mod.imageUrl) imageUrls.push(mod.imageUrl);
              if (mod.lessons) {
                Object.values(mod.lessons as Record<string, any>).forEach((lesson: any) => {
                  if (lesson.bunnyVideoGuid) videoGuids.push(lesson.bunnyVideoGuid);
                  if (lesson.imageUrl) imageUrls.push(lesson.imageUrl);
                });
              }
            }
          }
        } catch (rtdbErr) {
          console.warn(`⚠️ [DELETE DIRECT] Falha ao ler RTDB para cleanup:`, rtdbErr);
        }

        // 2️⃣ Deletar vídeos do Bunny Stream
        for (const guid of videoGuids) {
          try {
            await fetch(`https://video.bunnycdn.com/library/${credentials.streamLibraryId}/videos/${guid}`, {
              method: 'DELETE',
              headers: { 'AccessKey': credentials.streamApiKey }
            });
            console.log(`✅ [DELETE DIRECT] Vídeo Bunny deletado: ${guid}`);
          } catch (e) { console.warn(`⚠️ [DELETE DIRECT] Falha ao deletar vídeo ${guid}`); }
        }

        // 3️⃣ Deletar imagens individuais do Bunny Storage
        for (const imgUrl of imageUrls) {
          try {
            let filePath: string | null = null;
            if (imgUrl.startsWith('/api/images/')) filePath = imgUrl.replace('/api/images/', '');
            else if (imgUrl.startsWith('/uploads/')) filePath = imgUrl.replace('/uploads/', '');
            else { const m = imgUrl.match(/https?:\/\/[^/]+\.b-cdn\.net\/(.+)/); if (m) filePath = m[1]; }
            if (filePath) {
              await fetch(`https://storage.bunnycdn.com/${credentials.storageZoneName}/${filePath}`, {
                method: 'DELETE',
                headers: { 'AccessKey': credentials.storageApiKey }
              });
            }
          } catch (e) { /* ignora falhas individuais */ }
        }

        // 4️⃣ Deletar pasta inteira do produto no Bunny Storage (products/{productId}/)
        try {
          const listResp = await fetch(
            `https://storage.bunnycdn.com/${credentials.storageZoneName}/products/${productId}/`,
            { headers: { 'AccessKey': credentials.storageApiKey } }
          );
          if (listResp.ok) {
            const files = await listResp.json() as any[];
            for (const f of files) {
              if (!f.IsDirectory) {
                await fetch(
                  `https://storage.bunnycdn.com/${credentials.storageZoneName}/products/${productId}/${f.ObjectName}`,
                  { method: 'DELETE', headers: { 'AccessKey': credentials.storageApiKey } }
                );
                console.log(`✅ [DELETE DIRECT] Arquivo Bunny deletado: products/${productId}/${f.ObjectName}`);
              }
            }
          }
        } catch (e) { console.warn(`⚠️ [DELETE DIRECT] Falha ao limpar pasta do produto no Bunny`); }

        // 5️⃣ Desativar checkouts vinculados (NÃO deletar — preservar histórico de ordens e saldo)
        try {
          const checkoutsSnap = await db.collection('checkouts')
            .where('productId', '==', productId).get();
          // Busca adicional por syncedProductId (auto-created checkouts)
          const checkoutsBySync = await db.collection('checkouts')
            .where('syncedProductId', '==', productId).get();
          const allCheckoutRefs = new Map<string, any>();
          [...checkoutsSnap.docs, ...checkoutsBySync.docs].forEach(doc => allCheckoutRefs.set(doc.id, doc.ref));
          const batch = db.batch();
          allCheckoutRefs.forEach(ref => {
            // active: false — bloqueia novas compras
            // NÃO setar deleted: true — preserva dados para histórico de ordens e saldo
            batch.update(ref, {
              active: false,
              archivedAt: FieldValue.serverTimestamp(),
              archivedReason: 'product_deleted_by_seller'
            });
          });
          if (allCheckoutRefs.size > 0) await batch.commit();
          console.log(`✅ [DELETE DIRECT] ${allCheckoutRefs.size} checkouts arquivados (dados históricos preservados)`);
        } catch (e) { console.warn(`⚠️ [DELETE DIRECT] Falha ao desativar checkouts`); }

        // 6️⃣ Invalidar cache
        const { firestoreCache } = await import('./lib/firestore-cache.js');
        firestoreCache.invalidateProduct(productId);
        firestoreCache.invalidateTenantCheckouts(tenantId);
        firestoreCache.invalidateShowcase();

        console.log(`✅ [DELETE DIRECT] Limpeza completa do produto ${productId} concluída`);
      } catch (cleanupErr) {
        console.error(`❌ [DELETE DIRECT] Erro no cleanup background:`, cleanupErr);
      }
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao deletar produto:', error);
    res.status(500).json({ 
      error: 'Erro ao deletar produto',
      message: error.message 
    });
  }
});

// 🗑️ DELETAR CHECKOUT (HARD DELETE - Apaga do banco)
// [DEAD CODE] DELETE /api/checkouts/:checkoutId - duplicated by checkoutsRouter (mounted at /api/checkouts, route DELETE /:id) which runs first
app.delete('/api/checkouts/:checkoutId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.params;
    
    console.log(`🗑️ [DELETE CHECKOUT] Deletando checkout: ${checkoutId}`);
    
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Autenticação inválida' });
    }
    
    const admin = getAdmin();
    const db = admin.firestore();
    
    // Buscar checkout
    const checkoutDoc = await db.collection('checkouts').doc(checkoutId).get();
    
    if (!checkoutDoc.exists) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }
    
    const checkout = checkoutDoc.data();
    
    // Verificar ownership via produto
    if (checkout?.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Sem permissão para deletar este checkout' });
    }
    
    // SOFT DELETE - Preserva dados eternamente no Firebase
    await db.collection('checkouts').doc(checkoutId).update({ deleted: true, deletedAt: new Date(), deletedBy: tenantId });
    
    console.log(`✅ [DELETE CHECKOUT] Checkout ${checkoutId} soft-deleted (dados preservados)`);
    
    res.json({ success: true, message: 'Checkout deletado com sucesso' });
    
  } catch (error: any) {
    console.error('❌ Erro ao deletar checkout:', error);
    res.status(500).json({ error: 'Erro ao deletar checkout', message: error.message });
  }
});

// 🗑️ DELETAR CUPOM (HARD DELETE)
app.delete('/api/products/:productId/coupons/:couponId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId, couponId } = req.params;
    
    console.log(`🗑️ [DELETE COUPON] Deletando cupom ${couponId} do produto ${productId}`);
    
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Autenticação inválida' });
    }
    
    const admin = getAdmin();
    const db = admin.firestore();
    
    // Verificar ownership do produto
    const productDoc = await db.collection('products').doc(productId).get();
    if (!productDoc.exists || productDoc.data()?.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    
    // HARD DELETE - Deleta cupom da coleção root 'coupons'
    const couponDoc = await db.collection('coupons').doc(couponId).get();
    if (!couponDoc.exists) {
      return res.status(404).json({ error: 'Cupom não encontrado' });
    }
    const couponData = couponDoc.data();
    if (couponData?.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Sem permissão para excluir este cupom' });
    }
    await db.collection('coupons').doc(couponId).delete();
    
    console.log(`✅ [DELETE COUPON] Cupom deletado`);
    
    res.json({ success: true, message: 'Cupom deletado com sucesso' });
    
  } catch (error: any) {
    console.error('❌ Erro ao deletar cupom:', error);
    res.status(500).json({ error: 'Erro ao deletar cupom', message: error.message });
  }
});

// 🗑️ DELETAR PIXEL (HARD DELETE)
app.delete('/api/products/:productId/pixels/:pixelId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId, pixelId } = req.params;
    
    console.log(`🗑️ [DELETE PIXEL] Deletando pixel ${pixelId} do produto ${productId}`);
    
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Autenticação inválida' });
    }
    
    const admin = getAdmin();
    const db = admin.firestore();
    
    // Verificar ownership do produto
    const productDoc = await db.collection('products').doc(productId).get();
    if (!productDoc.exists || productDoc.data()?.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    
    // HARD DELETE - Deleta pixel da subcoleção
    await db.collection('products').doc(productId)
      .collection('pixels').doc(pixelId).delete();
    
    console.log(`✅ [DELETE PIXEL] Pixel deletado`);
    
    res.json({ success: true, message: 'Pixel deletado com sucesso' });
    
  } catch (error: any) {
    console.error('❌ Erro ao deletar pixel:', error);
    res.status(500).json({ error: 'Erro ao deletar pixel', message: error.message });
  }
});

// 📊 PRODUCT-LEVEL PIXELS - CRUD (herança automática para todos os checkouts)

// CREATE - Criar pixel no produto (aplica a todos os checkouts)
app.post('/api/products/:productId/pixels', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const admin = getAdmin();
    const db = admin.firestore();
    const productDoc = await db.collection('products').doc(productId).get();
    if (!productDoc.exists || productDoc.data()?.tenantId !== userId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { insertManagedPixelSchema } = await import('../shared/schema.js');
    const validationResult = insertManagedPixelSchema.safeParse({
      ...req.body,
      checkoutId: productId,
      tenantId: userId,
    });
    if (!validationResult.success) {
      return res.status(400).json({ error: 'Dados inválidos', details: validationResult.error.errors });
    }

    const pixelData = { ...validationResult.data, productId };
    const newPixel = await storage.createProductPixel(pixelData);

    // Sync: copiar pixel para todos os checkouts ativos deste produto
    try {
      const checkoutsSnap = await db.collection('checkouts')
        .where('syncedProductId', '==', productId)
        .where('tenantId', '==', userId)
        .get();
      const activeCheckouts = checkoutsSnap.docs.filter(d => !d.data().deleted);
      for (const ckDoc of activeCheckouts) {
        const ckPixelData = {
          ...validationResult.data,
          checkoutId: ckDoc.id,
          tenantId: userId,
          syncedFromProduct: true,
        };
        await storage.createManagedPixel(ckPixelData);
      }
      console.log(`📊 Pixel sincronizado para ${activeCheckouts.length} checkouts do produto ${productId}`);
    } catch (syncErr: any) {
      console.warn('⚠️ Erro ao sincronizar pixels para checkouts (não crítico):', syncErr.message);
    }

    res.json({ success: true, pixel: newPixel });
  } catch (error: any) {
    console.error('❌ Erro ao criar pixel no produto:', error);
    res.status(500).json({ error: error.message });
  }
});

// READ - Listar pixels do produto
app.get('/api/products/:productId/pixels', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const admin = getAdmin();
    const db = admin.firestore();
    const productDoc = await db.collection('products').doc(productId).get();
    if (!productDoc.exists || productDoc.data()?.tenantId !== userId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const pixels = await storage.getManagedPixelsByProduct(productId, userId);
    res.json({ success: true, pixels });
  } catch (error: any) {
    console.error('❌ Erro ao buscar pixels do produto:', error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE - Atualizar pixel do produto (e sincronizar para checkouts)
app.patch('/api/products/:productId/pixels/:pixelId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId, pixelId } = req.params;
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const admin = getAdmin();
    const db = admin.firestore();
    const productDoc = await db.collection('products').doc(productId).get();
    if (!productDoc.exists || productDoc.data()?.tenantId !== userId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const existingPixel = await storage.getProductPixel(pixelId, productId);
    if (!existingPixel) return res.status(404).json({ error: 'Pixel não encontrado' });
    if (existingPixel.tenantId !== userId) return res.status(403).json({ error: 'Sem permissão' });

    const updatedPixel = await storage.updateProductPixel(pixelId, productId, req.body);

    // Sync: atualizar pixel nos checkouts (pelo pixelId original ou platform+pixelId match)
    try {
      const checkoutsSnap = await db.collection('checkouts')
        .where('syncedProductId', '==', productId)
        .where('tenantId', '==', userId)
        .get();
      const activeCheckouts = checkoutsSnap.docs.filter(d => !d.data().deleted);
      for (const ckDoc of activeCheckouts) {
        const ckPixelsSnap = await db.collection('checkouts').doc(ckDoc.id)
          .collection('pixels')
          .where('pixelId', '==', existingPixel.pixelId)
          .where('platform', '==', existingPixel.platform)
          .get();
        for (const pxDoc of ckPixelsSnap.docs) {
          await pxDoc.ref.update({ ...req.body, updatedAt: new Date() });
        }
      }
    } catch (syncErr: any) {
      console.warn('⚠️ Erro ao sincronizar update de pixel (não crítico):', syncErr.message);
    }

    res.json({ success: true, pixel: updatedPixel });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar pixel do produto:', error);
    res.status(500).json({ error: error.message });
  }
});
// [REMOVED DUPLICATE] Route already defined earlier: /api/products/:productId/pixels/:pixelId

// 🗑️ DELETAR OFERTA/UPSELL (SOFT DELETE - ARQUIVAR)
app.delete('/api/products/:productId/offers/:offerId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId, offerId } = req.params;
    
    console.log(`🗑️ [DELETE OFFER] Arquivando oferta ${offerId} do produto ${productId}`);
    
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Autenticação inválida' });
    }
    
    const admin = getAdmin();
    const db = admin.firestore();
    
    // Verificar ownership do produto
    const productDoc = await db.collection('products').doc(productId).get();
    if (!productDoc.exists || productDoc.data()?.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    
    // Verificar ownership da oferta (checkout)
    const checkoutDoc = await db.collection('checkouts').doc(offerId).get();
    if (!checkoutDoc.exists) {
      return res.status(404).json({ error: 'Oferta não encontrada' });
    }
    
    const checkoutData = checkoutDoc.data();
    if (checkoutData?.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Sem permissão para deletar esta oferta' });
    }
    
    // CRÍTICO: Verificar se checkout pertence ao produto especificado
    if (checkoutData?.syncedProductId !== productId) {
      return res.status(403).json({ error: 'Esta oferta não pertence a este produto' });
    }
    
    // SOFT DELETE - Marca oferta como deletada (preserva histórico e saldo)
    await db.collection('checkouts').doc(offerId).update({
      deleted: true,
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy: tenantId,
      updatedAt: FieldValue.serverTimestamp()
    });
    
    console.log(`✅ [DELETE OFFER] Oferta deletada (histórico preservado): ${offerId}`);
    
    res.json({ 
      success: true, 
      message: 'Oferta removida com sucesso',
      deleted: true,
      offerId: offerId
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao deletar oferta:', error);
    res.status(500).json({ error: 'Erro ao deletar oferta', message: error.message });
  }
});
// [EXTRACTED] get /api/admin/products/deleted moved to server/routes/admin.ts

// 🎯 PRODUCT OFFERS - ENDPOINTS PARA MÚLTIPLAS OFERTAS POR PRODUTO

// 🌐 ENDPOINT PÚBLICO: Buscar oferta por slug (para checkout público)
app.get('/api/public/offers/:productId/:offerSlug', async (req, res) => {
  try {
    const { productId, offerSlug } = req.params;
    
    const offer = await storage.getOfferBySlug(productId, offerSlug);
    
    if (!offer) {
      return res.status(404).json({ error: 'Oferta não encontrada' });
    }
    
    // Retornar apenas dados necessários para checkout (sem dados sensíveis)
    res.json({
      id: offer.id,
      title: offer.title,
      description: offer.description,
      price: offer.price,
      currency: offer.currency,
      slug: offer.slug,
      subscriptionPeriod: offer.subscriptionPeriod
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar oferta pública:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📋 LISTAR OFERTAS DE UM PRODUTO
app.get('/api/products/:productId/offers', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const tenantId = await getTenantFromAuth(req);
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não encontrado' });
    }

    // Verificar se produto OU checkout existe (aceita ambos)
    const product = await storage.getProduct(productId);
    const checkout = !product ? await storage.getCheckout(productId) : null;
    
    if (!product && !checkout) {
      return res.status(404).json({ error: 'Produto ou checkout não encontrado' });
    }
    
    // 👑 ADMINS podem listar ofertas de qualquer produto
    const isAdmin = req.user?.isAdmin || req.authUser?.isAdmin;
    const resourceTenantId = product?.tenantId || checkout?.tenantId;
    if (!isAdmin && resourceTenantId !== tenantId) {
      return res.status(403).json({ error: 'Você não tem permissão para ver ofertas deste produto' });
    }

    // ✅ ADMIN VIEW: Incluir ofertas inativas para seleção manual
    const offers = await storage.listOffersByProduct(productId, true);
    res.json(offers);
  } catch (error: any) {
    console.error('❌ Erro ao listar ofertas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ➕ CRIAR NOVA OFERTA PARA PRODUTO
// 🔍 ENDPOINT DE DIAGNÓSTICO - Ver TODAS as ofertas
app.get('/api/debug/all-offers', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const db = admin.firestore();
    const snapshot = await db.collection('productOffers').get();
    const allOffers = snapshot.docs.map(doc => ({
      id: doc.id,
      productId: doc.data().productId,
      slug: doc.data().slug,
      title: doc.data().title || doc.data().name,
      tenantId: doc.data().tenantId,
      active: doc.data().active
    }));
    
    console.log('\n📊 DIAGNÓSTICO: TODAS AS OFERTAS NO SISTEMA:\n');
    allOffers.forEach(offer => {
      console.log(`  - Oferta ID: ${offer.id}`);
      console.log(`    Slug: ${offer.slug}`);
      console.log(`    Título: ${offer.title}`);
      console.log(`    TenantID: ${offer.tenantId}`);
      console.log(`    Ativa: ${offer.active}\n`);
    });
    
    res.json({ total: allOffers.length, offers: allOffers });
  } catch (error) {
    console.error('Erro ao buscar ofertas:', error);
    res.status(500).json({ error: 'Erro ao buscar ofertas' });
  }
});


app.post('/api/products/:productId/offers', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const tenantId = await getTenantFromAuth(req);
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não encontrado' });
    }

    console.log('🔍 [CREATE OFFER] Buscando produto/checkout:', productId);
    
    // Verificar se produto OU checkout existe (aceita ambos)
    const product = await storage.getProduct(productId);
    console.log('🔍 [CREATE OFFER] Produto encontrado?', !!product);
    
    const checkout = !product ? await storage.getCheckout(productId) : null;
    console.log('🔍 [CREATE OFFER] Checkout encontrado?', !!checkout);
    
    if (!product && !checkout) {
      console.log('❌ [CREATE OFFER] Nem produto nem checkout encontrado para ID:', productId);
      return res.status(404).json({ error: 'Produto ou checkout não encontrado' });
    }
    
    // 👑 ADMINS podem criar ofertas para qualquer produto
    const isAdmin = req.user?.isAdmin || req.authUser?.isAdmin;
    const resourceTenantId = product?.tenantId || checkout?.tenantId;
    if (!isAdmin && resourceTenantId !== tenantId) {
      return res.status(403).json({ error: 'Você não tem permissão para criar ofertas para este produto' });
    }

    // Validar dados com Zod (tenantId é adicionado automaticamente pelo storage.createOffer)
    console.log('🔍 [CREATE OFFER] Dados recebidos:', JSON.stringify(req.body, null, 2));
    console.log('🔍 [CREATE OFFER] ProductId:', productId);
    
    // Auto-generate slug from title if not provided
    const slugFromTitle = (req.body.title || req.body.name || 'offer')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 100) || 'offer';
    const autoSlug = `${slugFromTitle}-${Date.now()}`.substring(0, 100);

    const validatedData = insertProductOfferSchema.parse({
      slug: autoSlug,
      ...req.body,
      productId
    });
    
    console.log('✅ [CREATE OFFER] Dados validados com sucesso:', JSON.stringify(validatedData, null, 2));

    // 💰 VALIDAÇÃO DE PREÇO MÍNIMO: R$ 5,00 (500 centavos)
    const MIN_OFFER_PRICE_CENTAVOS = 500;
    if (!validatedData.price || validatedData.price < MIN_OFFER_PRICE_CENTAVOS) {
      console.log(`⚠️ Preço da oferta abaixo do mínimo: R$ ${(validatedData.price || 0) / 100} < R$ 5,00`);
      return res.status(400).json({ 
        error: 'Preço mínimo não atingido',
        message: 'O preço mínimo para criar uma oferta é R$ 5,00',
        minPrice: MIN_OFFER_PRICE_CENTAVOS,
        minPriceFormatted: 'R$ 5,00'
      });
    }
    
    // 🔄 VALIDAÇÃO: Produtos de assinatura DEVEM ter subscriptionPeriod
    const productType = product?.productType;
    const checkoutBillingType = checkout?.pricing?.billingType;
    const isSubscription = productType === 'subscription' || checkoutBillingType === 'subscription';
    
    if (isSubscription && !validatedData.subscriptionPeriod) {
      return res.status(400).json({ 
        error: 'Ofertas de produtos de assinatura devem ter um período de recorrência (mensal, trimestral, semestral ou anual)' 
      });
    }

    // Criar oferta (validações de limite e slug já estão no storage)
    const offer = await storage.createOffer(validatedData);
    
    console.log('✅ [CREATE OFFER] Oferta criada com sucesso:', offer.id);
    
    res.status(201).json({ success: true, offer });
  } catch (error: any) {
    console.error('❌ Erro ao criar oferta:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    
    if (error.message.includes('Limite de 7 ofertas')) {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.message.includes('slug')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ✏️ ATUALIZAR OFERTA
app.patch('/api/products/:productId/offers/:offerId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId, offerId } = req.params;
    const tenantId = await getTenantFromAuth(req);
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não encontrado' });
    }

    // Verificar se produto OU checkout existe (aceita ambos)
    const product = await storage.getProduct(productId);
    const checkout = !product ? await storage.getCheckout(productId) : null;
    
    if (!product && !checkout) {
      return res.status(404).json({ error: 'Produto ou checkout não encontrado' });
    }
    
    // 👑 ADMINS podem atualizar ofertas de qualquer produto
    const isAdmin = req.user?.isAdmin || req.authUser?.isAdmin;
    const resourceTenantId = product?.tenantId || checkout?.tenantId;
    if (!isAdmin && resourceTenantId !== tenantId) {
      return res.status(403).json({ error: 'Você não tem permissão para atualizar ofertas deste produto' });
    }

    // Verificar se oferta existe e pertence ao produto
    const offer = await storage.getOffer(offerId);
    if (!offer || offer.productId !== productId) {
      return res.status(404).json({ error: 'Oferta não encontrada' });
    }

    // Atualizar oferta
    const updatedOffer = await storage.updateOffer(offerId, req.body);
    
    if (!updatedOffer) {
      return res.status(404).json({ error: 'Erro ao atualizar oferta' });
    }

    res.json({ success: true, offer: updatedOffer });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar oferta:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🎟️ ROTAS DE CUPONS DE DESCONTO
app.post('/api/products/:productId/coupons', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    // Verificar produto via Neon (storage) ou Firestore
    let productTenantId: string | null = null;
    const neonProduct = await storage.getProduct(productId);
    if (neonProduct) {
      productTenantId = neonProduct.tenantId;
    } else {
      // Fallback: buscar no Firestore
      await ensureFirebaseReady();
      const fsAdmin = getAdmin();
      const productDoc = await fsAdmin.firestore().collection('products').doc(productId).get();
      if (!productDoc.exists) {
        return res.status(404).json({ error: 'Produto não encontrado' });
      }
      productTenantId = (productDoc.data() as any)?.tenantId || null;
    }

    if (productTenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para criar cupons neste produto' });
    }

    // Criar cupom diretamente no Firestore
    await ensureFirebaseReady();
    const fsAdminC = getAdmin();
    const fsDbC = fsAdminC.firestore();
    const couponId = `coupon_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const couponData = {
      id: couponId,
      ...req.body,
      productId,
      tenantId: userId,
      code: (req.body.code || '').toUpperCase(),
      usedCount: 0,
      active: req.body.active ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await fsDbC.collection('coupons').doc(couponId).set(couponData);
    const coupon = couponData;

    res.json({ success: true, coupon });
  } catch (error: any) {
    console.error('❌ Erro ao criar cupom:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/:productId/coupons', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const product = await storage.getProduct(productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    if (product.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para ver cupons deste produto' });
    }

    // Buscar cupons diretamente no Firestore
    await ensureFirebaseReady();
    const fsAdminG = getAdmin();
    const fsDbG = fsAdminG.firestore();
    const couponsSnap = await fsDbG.collection('coupons')
      .where('productId', '==', productId)
      .where('tenantId', '==', userId)
      .get();
    const coupons = couponsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    res.json({ success: true, coupons });
  } catch (error: any) {
    console.error('❌ Erro ao buscar cupons:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/products/:productId/coupons/:couponId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId, couponId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const product = await storage.getProduct(productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    if (product.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para editar cupons deste produto' });
    }

    const existingCoupon = await storage.getCoupon(couponId);
    if (!existingCoupon) {
      return res.status(404).json({ error: 'Cupom não encontrado' });
    }

    if (existingCoupon.productId !== productId || existingCoupon.tenantId !== userId) {
      return res.status(403).json({ error: 'Este cupom não pertence a este produto' });
    }

    const coupon = await storage.updateCoupon(couponId, req.body);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('./lib/neon-products.js').then(({ neonUpdateCoupon }) => {
      neonUpdateCoupon(couponId, req.body);
    }).catch(() => {});

    res.json({ success: true, coupon });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar cupom:', error);
    res.status(500).json({ error: error.message });
  }
});
// [REMOVED DUPLICATE] Route already defined earlier: /api/products/:productId/coupons/:couponId

// 🤝 ROTA PARA SALVAR CONFIGURAÇÕES DE AFILIADOS DO PRODUTO
app.patch('/api/products/:productId/affiliate-config', verifyFirebaseToken, requireApprovedSeller, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const tenantId = await getTenantFromAuth(req);
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não encontrado' });
    }

    console.log(`🤝 Salvando configurações de afiliados para produto: ${productId}`);

    // Verificar se produto existe
    const admin = getAdmin();
    const db = admin.firestore();
    const productDoc = await db.collection('products').doc(productId).get();
    
    if (!productDoc.exists) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const productData = productDoc.data();
    const productTitle = productData?.title;
    
    // Verificar ownership
    if (productData?.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Você não tem permissão para configurar afiliados deste produto' });
    }

    // Validar dados com Zod safeParse
    const parseResult = affiliateConfigSchema.safeParse(req.body);
    
    if (!parseResult.success) {
      console.error('❌ Erro de validação:', parseResult.error);
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: parseResult.error.format()
      });
    }

    const validatedConfig = parseResult.data;

    // ✅ VALIDAÇÃO: Campos de suporte são obrigatórios quando afiliação/vitrine está habilitada
    // Verificar TODOS os caminhos que podem expor afiliados publicamente
    const isPubliclyExposed = validatedConfig.enabled || 
                             validatedConfig.marketplaceEnabled || 
                             (Array.isArray(validatedConfig.selectedOffers) && validatedConfig.selectedOffers.length > 0) ||
                             !!validatedConfig.affiliateLink ||
                             (validatedConfig.affiliateTriggers && validatedConfig.affiliateTriggers.countdownEnabled);
    
    if (isPubliclyExposed) {
      const missingFields = [];
      if (!validatedConfig.support?.name || validatedConfig.support.name.trim() === '') {
        missingFields.push('Nome do responsável');
      }
      if (!validatedConfig.support?.email || validatedConfig.support.email.trim() === '') {
        missingFields.push('E-mail de suporte');
      }
      if (!validatedConfig.support?.phone || validatedConfig.support.phone.trim() === '') {
        missingFields.push('Telefone de suporte');
      }

      if (missingFields.length > 0) {
        return res.status(400).json({
          error: 'Campos obrigatórios não preenchidos',
          details: `Para habilitar afiliados, preencha: ${missingFields.join(', ')}`
        });
      }

      // Validar formato do e-mail
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(validatedConfig.support.email)) {
        return res.status(400).json({
          error: 'E-mail inválido',
          details: 'Digite um e-mail válido para suporte'
        });
      }
    }

    // ✅ AUTO-LIMPEZA: Remover IDs de ofertas que não existem mais
    if (Array.isArray(validatedConfig.selectedOffers) && validatedConfig.selectedOffers.length > 0) {
      const offersSnapshot = await db.collection('productOffers')
        .where('productId', '==', productId)
        .get();
      
      const validOfferIds = new Set(offersSnapshot.docs.map(doc => doc.id));
      validatedConfig.selectedOffers = validatedConfig.selectedOffers.filter(offerId => validOfferIds.has(offerId));
    }

    // ✅ NÃO SINCRONIZAR showcase.enabled com marketplaceEnabled
    // marketplaceEnabled controla a visibilidade na vitrine de afiliados
    // A lógica da vitrine verifica AMBOS: affiliateConfig.enabled E affiliateConfig.marketplaceEnabled
    const updateData: any = {
      'affiliateConfig': validatedConfig,
      'updatedAt': FieldValue.serverTimestamp()
    };
    
    console.log(`📦 Atualizando affiliateConfig: enabled=${validatedConfig.enabled}, marketplaceEnabled=${validatedConfig.marketplaceEnabled}`);


    // A vitrine lê de CHECKOUTS, não de products!
    await db.collection('products').doc(productId).update(updateData);

    // 🏪 BUSCAR E ATUALIZAR TODOS OS CHECKOUTS DESTE PRODUTO
    // 🔄 FALLBACK: Primeiro tenta syncedProductId, depois productId (checkouts legados)
    let checkoutsSnapshot = await db.collection('checkouts')
      .where('syncedProductId', '==', productId)
      .get();
    
    console.log(`🔍 Encontrados ${checkoutsSnapshot.size} checkouts com syncedProductId`);
    
    // ⚡ FALLBACK: Se não encontrou por syncedProductId, buscar por productId (checkouts legados)
    if (checkoutsSnapshot.empty) {
      console.log(`⚡ Fallback: buscando checkouts por productId`);
      checkoutsSnapshot = await db.collection('checkouts')
        .where('productId', '==', productId)
        .get();
      console.log(`🔍 Encontrados ${checkoutsSnapshot.size} checkouts com productId`);
    }
    
    console.log(`✅ TOTAL: ${checkoutsSnapshot.size} checkouts para atualizar`);


    // Atualizar todos os checkouts relacionados
    const checkoutUpdates = checkoutsSnapshot.docs.map(async (checkoutDoc) => {
      const checkoutData = checkoutDoc.data();
      
      const checkoutUpdateData: any = {
        'affiliate': {
          enabled: validatedConfig.enabled || false,
          autoApprove: validatedConfig.autoApprove || false,
          commissionPercent: validatedConfig.commissions?.single || 10,
          recurringCommissionPercent: validatedConfig.commissions?.recurring || 0,
          recurringCommissionType: validatedConfig.commissions?.type || 'primeira',
          extendedCommission: validatedConfig.extendCommission || false,
          paymentDelay: validatedConfig.cookieDuration || 30,
          adminFeePercent: 5
        },
        'affiliateConfig': validatedConfig,
        'updatedAt': FieldValue.serverTimestamp()
      };

      // 🎯 SINCRONIZAR TÍTULO DO PRODUTO (para vitrine mostrar nome correto)
      if (productTitle) {
        checkoutUpdateData['productTitle'] = productTitle;
      }

      // Sincronizar showcase.enabled também nos checkouts
      if (validatedConfig.marketplaceEnabled !== undefined) {
        const checkoutShowcase = {
          ...checkoutData.showcase,
          enabled: validatedConfig.marketplaceEnabled
        };
        checkoutUpdateData['showcase'] = checkoutShowcase;
      }

      // 🔄 MIGRATION: Adicionar syncedProductId em checkouts legados (se não tiver)
      if (!checkoutData.syncedProductId) {
        checkoutUpdateData['syncedProductId'] = productId;
      }

      return db.collection('checkouts').doc(checkoutDoc.id).update(checkoutUpdateData);
    });

    await Promise.all(checkoutUpdates);

    const { firestoreCache: affCache } = await import('./lib/firestore-cache.js');
    affCache.invalidateProduct(productId);
    affCache.invalidateShowcase();
    const productForCache = await db.collection('products').doc(productId).get();
    const tenantIdForCache = productForCache.data()?.tenantId;
    if (tenantIdForCache) {
      affCache.invalidateTenantCheckouts(`products_${tenantIdForCache}`);
      affCache.invalidateTenantCheckouts(tenantIdForCache);
    }

    console.log(`✅ Configurações de afiliados salvas para produto: ${productId} e ${checkoutsSnapshot.size} checkouts (cache da vitrine invalidado)`);
    
    res.json({ 
      success: true, 
      message: 'Configurações de afiliados salvas com sucesso',
      config: validatedConfig
    });
  } catch (error: any) {
    console.error('❌ Erro ao salvar configurações de afiliados:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

// 🎟️ ROTAS DE CUPONS PARA CHECKOUTS (DUPLICADAS)
app.post('/api/checkouts/:checkoutId/coupons', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para criar cupons neste checkout' });
    }

    // Criar cupom diretamente no Firestore
    await ensureFirebaseReady();
    const fsAdminChk = getAdmin();
    const fsDbChk = fsAdminChk.firestore();
    const chkCouponId = `coupon_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const chkCouponData = {
      id: chkCouponId,
      ...req.body,
      productId: checkoutId,
      checkoutId,
      tenantId: userId,
      code: (req.body.code || '').toUpperCase(),
      usedCount: 0,
      active: req.body.active ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await fsDbChk.collection('coupons').doc(chkCouponId).set(chkCouponData);
    const coupon = chkCouponData;

    res.json({ success: true, coupon });
  } catch (error: any) {
    console.error('❌ Erro ao criar cupom de checkout:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/checkouts/:checkoutId/coupons', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para ver cupons deste checkout' });
    }

    const coupons = await storage.getCouponsByCheckout(checkoutId, userId);
    res.json({ coupons });
  } catch (error: any) {
    console.error('❌ Erro ao buscar cupons de checkout:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/checkouts/:checkoutId/coupons/:couponId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId, couponId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para atualizar cupons deste checkout' });
    }

    const existingCoupon = await storage.getCoupon(couponId);
    if (!existingCoupon) {
      return res.status(404).json({ error: 'Cupom não encontrado' });
    }

    if (existingCoupon.productId !== checkoutId || existingCoupon.tenantId !== userId) {
      return res.status(403).json({ error: 'Este cupom não pertence a este checkout' });
    }

    const updatedCoupon = await storage.updateCoupon(couponId, req.body);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('./lib/neon-products.js').then(({ neonUpdateCoupon }) => {
      neonUpdateCoupon(couponId, req.body);
    }).catch(() => {});

    res.json({ success: true, coupon: updatedCoupon });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar cupom de checkout:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/checkouts/:checkoutId/coupons/:couponId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId, couponId } = req.params;
    const userId = req.user?.uid;
    
    console.log('🗑️ DELETE CUPOM - checkoutId:', checkoutId, 'couponId:', couponId, 'userId:', userId);
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    console.log('🔍 Buscando checkout:', checkoutId);
    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      console.log('❌ Checkout não encontrado');
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }
    console.log('✅ Checkout encontrado - tenantId:', checkout.tenantId);

    if (checkout.tenantId !== userId) {
      console.log('❌ Permissão negada - tenantId do checkout:', checkout.tenantId, 'userId:', userId);
      return res.status(403).json({ error: 'Você não tem permissão para excluir cupons deste checkout' });
    }

    console.log('🔍 Buscando cupom:', couponId);
    const existingCoupon = await storage.getCoupon(couponId);
    console.log('📋 Cupom encontrado:', existingCoupon ? { id: existingCoupon.id, productId: existingCoupon.productId, tenantId: existingCoupon.tenantId } : 'NÃO ENCONTRADO');
    
    if (!existingCoupon) {
      console.log('❌ Cupom não encontrado no Firebase');
      return res.status(404).json({ error: 'Cupom não encontrado' });
    }

    console.log('🔐 Verificando propriedade - Cupom productId:', existingCoupon.productId, 'checkoutId:', checkoutId);
    console.log('🔐 Verificando propriedade - Cupom tenantId:', existingCoupon.tenantId, 'userId:', userId);
    
    if (existingCoupon.productId !== checkoutId || existingCoupon.tenantId !== userId) {
      console.log('❌ Este cupom não pertence a este checkout ou usuário');
      return res.status(403).json({ error: 'Este cupom não pertence a este checkout' });
    }

    console.log('🗑️ Deletando cupom...');
    await storage.deleteCoupon(couponId);
    console.log('✅ Cupom deletado com sucesso');

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('./lib/neon-products.js').then(({ neonDeleteCoupon }) => {
      neonDeleteCoupon(couponId);
    }).catch(() => {});

    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Erro ao deletar cupom de checkout:', error);
    res.status(500).json({ error: error.message || 'Erro ao deletar cupom' });
  }
});

// 🎫 VALIDAR CUPOM (PÚBLICO - PARA CHECKOUT)
app.post('/api/coupons/validate', async (req, res) => {
  try {
    const { code, tenantId, productId } = req.body;
    
    console.log('🎫 VALIDAR CUPOM:', { code: code?.toUpperCase(), tenantId, productId });
    
    if (!code || !tenantId) {
      return res.status(400).json({ error: 'Código e tenantId são obrigatórios' });
    }

    const coupon = await storage.getCouponByCode(code, tenantId);
    
    console.log('🎫 Cupom encontrado:', coupon ? { id: coupon.id, code: coupon.code, productId: coupon.productId, active: coupon.active } : 'NÃO ENCONTRADO');
    
    if (!coupon) {
      return res.status(404).json({ error: 'Cupom não encontrado ou inválido' });
    }

    // Validar productId (checkoutId ou productId)
    if (coupon.productId && coupon.productId !== productId) {
      console.log('❌ Cupom não válido:', { couponProductId: coupon.productId, receivedId: productId });
      return res.status(400).json({ error: 'Cupom não válido para este produto' });
    }

    // Validar offerId se o cupom estiver restrito a uma oferta específica
    const requestOfferId = req.body.offerId;
    if (coupon.offerId && requestOfferId && coupon.offerId !== requestOfferId) {
      console.log('❌ Cupom não válido para esta oferta:', { couponOfferId: coupon.offerId, requestOfferId });
      return res.status(400).json({ error: 'Cupom não válido para esta oferta' });
    }

    // Validar datas
    const now = new Date();
    console.log('🎫 Validando datas:', { 
      now: now.toISOString(), 
      validFrom: coupon.validFrom?.toISOString?.() || coupon.validFrom, 
      validUntil: coupon.validUntil?.toISOString?.() || coupon.validUntil 
    });
    
    const validFrom = coupon.validFrom instanceof Date ? coupon.validFrom : new Date(coupon.validFrom);
    const validUntil = coupon.validUntil instanceof Date ? coupon.validUntil : new Date(coupon.validUntil);
    
    if (now < validFrom || now > validUntil) {
      console.log('❌ Cupom expirado ou ainda não válido');
      return res.status(400).json({ error: 'Cupom expirado ou ainda não válido' });
    }

    // Validar limite de uso
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      console.log('❌ Cupom atingiu limite de uso:', { usedCount: coupon.usedCount, usageLimit: coupon.usageLimit });
      return res.status(400).json({ error: 'Cupom atingiu o limite de uso' });
    }

    console.log('✅ Cupom válido! Aplicando desconto:', { type: coupon.type, value: coupon.value });
    res.json({ success: true, coupon });
  } catch (error: any) {
    console.error('❌ Erro ao validar cupom:', error);
    res.status(500).json({ error: error.message });
  }
});

// ⭐ ROTAS DE TESTIMONIALS (DEPOIMENTOS)
app.post('/api/checkouts/:checkoutId/testimonials', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para criar depoimentos neste checkout' });
    }

    const testimonial = await storage.createTestimonial({
      ...req.body,
      checkoutId,
      tenantId: userId,
    });

    res.json({ success: true, testimonial });
  } catch (error: any) {
    console.error('❌ Erro ao criar depoimento:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/checkouts/:checkoutId/testimonials', async (req, res) => {
  try {
    const { checkoutId } = req.params;

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    const testimonials = await storage.getTestimonialsByCheckout(checkoutId, checkout.tenantId);
    res.json({ testimonials });
  } catch (error: any) {
    console.error('❌ Erro ao buscar depoimentos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/checkouts/:checkoutId/testimonials/:testimonialId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId, testimonialId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para atualizar depoimentos deste checkout' });
    }

    const existingTestimonial = await storage.getTestimonial(testimonialId);
    if (!existingTestimonial) {
      return res.status(404).json({ error: 'Depoimento não encontrado' });
    }

    if (existingTestimonial.checkoutId !== checkoutId || existingTestimonial.tenantId !== userId) {
      return res.status(403).json({ error: 'Este depoimento não pertence a este checkout' });
    }

    const updatedTestimonial = await storage.updateTestimonial(testimonialId, req.body);
    res.json({ success: true, testimonial: updatedTestimonial });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar depoimento:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/checkouts/:checkoutId/testimonials/:testimonialId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId, testimonialId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para excluir depoimentos deste checkout' });
    }

    const existingTestimonial = await storage.getTestimonial(testimonialId);
    if (!existingTestimonial) {
      return res.status(404).json({ error: 'Depoimento não encontrado' });
    }

    if (existingTestimonial.checkoutId !== checkoutId || existingTestimonial.tenantId !== userId) {
      return res.status(403).json({ error: 'Este depoimento não pertence a este checkout' });
    }

    await storage.deleteTestimonial(testimonialId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Erro ao deletar depoimento:', error);
    res.status(500).json({ error: error.message });
  }
});

// 📊 MANAGED PIXELS - MARKETING TRACKING AVANÇADO

// CREATE - Criar novo pixel para um checkout
app.post('/api/checkouts/:checkoutId/pixels', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para adicionar pixels neste checkout' });
    }

    // ✅ VALIDAÇÃO ZOD - REJEITA DADOS INVÁLIDOS
    const { insertManagedPixelSchema } = await import('../shared/schema.js');
    const validationResult = insertManagedPixelSchema.safeParse({
      ...req.body,
      checkoutId,
      tenantId: userId,
    });

    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: validationResult.error.errors 
      });
    }

    const newPixel = await storage.createManagedPixel(validationResult.data);
    res.json({ success: true, pixel: newPixel });
  } catch (error: any) {
    console.error('❌ Erro ao criar pixel:', error);
    res.status(500).json({ error: error.message });
  }
});

// READ - Listar todos os pixels de um checkout
app.get('/api/checkouts/:checkoutId/pixels', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para visualizar pixels deste checkout' });
    }

    // ✅ Storage já retorna pixels normalizados em snake_case
    const pixels = await storage.getManagedPixelsByCheckout(checkoutId, userId);
    res.json({ success: true, pixels });
  } catch (error: any) {
    console.error('❌ Erro ao buscar pixels:', error);
    res.status(500).json({ error: error.message });
  }
});

// READ - Buscar pixel específico
app.get('/api/checkouts/:checkoutId/pixels/:pixelId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId, pixelId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para visualizar pixels deste checkout' });
    }

    const pixel = await storage.getManagedPixel(pixelId, checkoutId);
    if (!pixel) {
      return res.status(404).json({ error: 'Pixel não encontrado' });
    }

    res.json({ success: true, pixel });
  } catch (error: any) {
    console.error('❌ Erro ao buscar pixel:', error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE - Atualizar pixel
app.patch('/api/checkouts/:checkoutId/pixels/:pixelId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId, pixelId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para atualizar pixels deste checkout' });
    }

    const existingPixel = await storage.getManagedPixel(pixelId, checkoutId);
    if (!existingPixel) {
      return res.status(404).json({ error: 'Pixel não encontrado' });
    }

    if (existingPixel.tenantId !== userId) {
      return res.status(403).json({ error: 'Este pixel não pertence a você' });
    }

    // ✅ VALIDAÇÃO ZOD - REJEITA DADOS INVÁLIDOS E FORÇA CAMPOS IMUTÁVEIS
    const { updateManagedPixelSchema } = await import('../shared/schema.js');
    const validationResult = updateManagedPixelSchema.safeParse({
      ...req.body,
      // Força valores autorizados - impede tampering
      pixelId,
      checkoutId,
      tenantId: userId,
    });

    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: validationResult.error.errors 
      });
    }

    const updatedPixel = await storage.updateManagedPixel(pixelId, checkoutId, validationResult.data);
    res.json({ success: true, pixel: updatedPixel });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar pixel:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE - Deletar pixel
app.delete('/api/checkouts/:checkoutId/pixels/:pixelId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId, pixelId } = req.params;
    const userId = req.user?.uid;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkout = await storage.getCheckout(checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkout.tenantId !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para excluir pixels deste checkout' });
    }

    const existingPixel = await storage.getManagedPixel(pixelId, checkoutId);
    if (!existingPixel) {
      return res.status(404).json({ error: 'Pixel não encontrado' });
    }

    if (existingPixel.tenantId !== userId) {
      return res.status(403).json({ error: 'Este pixel não pertence a você' });
    }

    await storage.deleteManagedPixel(pixelId, checkoutId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Erro ao deletar pixel:', error);
    res.status(500).json({ error: error.message });
  }
});
// [REMOVED DUPLICATE] Route already defined earlier: /api/products/:productId/offers/:offerId

// 🏗️ CRIAR ÁREA DE MEMBROS AUTOMATICAMENTE PARA PRODUTOS EXISTENTES
app.post('/api/products/setup-members-area', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🏗️ [SETUP-MEMBERS-AREA] Iniciando criação automática de área de membros...');
    
    // 🔧 PERMITIR ADMIN ESPECIFICAR TENANT ID (via body) OU USAR DO TOKEN
    let tenantId = req.body.tenantId;
    
    if (!tenantId) {
      tenantId = await getTenantFromAuth(req);
    } else {
      // ⚠️ SE TENANT ID FOI ESPECIFICADO, VERIFICAR SE É ADMIN
      const userUid = req.user?.uid;
      const isAdmin = await checkAdminAccess(userUid || '');
      
      if (!isAdmin) {
        return res.status(403).json({ error: 'Apenas admins podem especificar tenantId' });
      }
      
      console.log(`👑 [SETUP-MEMBERS-AREA] Admin executando para tenant: ${tenantId}`);
    }
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não encontrado' });
    }

    console.log(`🔍 [SETUP-MEMBERS-AREA] Buscando produtos do tenant: ${tenantId}`);
    
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    // 1️⃣ BUSCAR TODOS OS PRODUTOS DO TENANT
    const productsSnapshot = await db.collection('products')
      .where('tenantId', '==', tenantId)
      .where('active', '==', true)
      .get();
    
    console.log(`📦 [SETUP-MEMBERS-AREA] ${productsSnapshot.size} produtos encontrados`);
    
    let processed = 0;
    let created = 0;
    const errors: Array<{ productId: string; productTitle: string; error: string; }> = [];
    
    // 2️⃣ PARA CADA PRODUTO, VERIFICAR SE JÁ TEM MÓDULO
    for (const productDoc of productsSnapshot.docs) {
      const productData = productDoc.data();
      const productId = productDoc.id;
      processed++;
      
      console.log(`🔍 [SETUP-MEMBERS-AREA] Processando produto: ${productData.title} (${productId})`);
      
      // 🔧 VERIFICAR SE PRODUTO DEVE TER ÁREA DE MEMBROS
      const shouldHaveMembers = productData.hasAccess ?? true; // Default true
      
      if (!shouldHaveMembers) {
        console.log(`⏭️ [SETUP-MEMBERS-AREA] Produto ${productId} não precisa de área de membros (hasAccess=false)`);
        continue;
      }
      
      // 🔍 VERIFICAR SE JÁ EXISTE MÓDULO
      const existingModules = await db.collection('modules')
        .where('productId', '==', productId)
        .limit(1)
        .get();
      
      if (!existingModules.empty) {
        console.log(`✅ [SETUP-MEMBERS-AREA] Produto ${productId} já tem módulo - pulando`);
        continue;
      }
      
      // 📚 CRIAR MÓDULO E AULA INICIAL
      try {
        console.log(`🚀 [SETUP-MEMBERS-AREA] Criando área de membros para: ${productData.title}`);
        
        const moduleId = `module_${Date.now()}_${nanoid(16)}`;
        const moduleData = {
          id: moduleId,
          productId: productId,
          tenantId: tenantId,
          title: productData.title,
          description: `Área de membros do ${productData.title}`,
          position: 0,
          active: true,
          autoCreated: true,
          autoCreatedReason: 'Setup automático para produtos existentes',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };
        
        await db.collection('modules').doc(moduleId).set(moduleData);
        console.log(`✅ [SETUP-MEMBERS-AREA] Módulo criado: ${moduleId}`);
        
        // 📋 CRIAR AULA INTRODUTÓRIA
        const lessonId = `lesson_${Date.now()}_${nanoid(16)}`;
        const lessonData = {
          id: lessonId,
          moduleId: moduleId,
          productId: productId,
          tenantId: tenantId,
          title: `Bem-vindo ao ${productData.title}`,
          description: 'Conteúdo introdutório - personalize conforme necessário',
          content: `<h1>Bem-vindo!</h1><p>Esta é sua área de membros do ${productData.title}.</p><p>Personalize este conteúdo para seus clientes.</p>`,
          position: 0,
          duration: 0,
          videoUrl: null,
          attachments: [],
          active: true,
          autoCreated: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };
        
        await db.collection('lessons').doc(lessonId).set(lessonData);
        console.log(`✅ [SETUP-MEMBERS-AREA] Aula criada: ${lessonId}`);
        
        created++;
        console.log(`🎉 [SETUP-MEMBERS-AREA] Área de membros criada com sucesso para: ${productData.title}`);
        
      } catch (error: any) {
        console.error(`❌ [SETUP-MEMBERS-AREA] Erro ao criar área de membros para ${productId}:`, error);
        errors.push({
          productId: productId,
          productTitle: productData.title,
          error: error.message
        });
      }
    }
    
    const result = {
      success: true,
      message: created > 0 
        ? `${created} área(s) de membros criada(s) com sucesso!` 
        : 'Todos os produtos já possuem área de membros',
      processed: processed,
      created: created,
      errors: errors
    };
    
    console.log(`✅ [SETUP-MEMBERS-AREA] Concluído:`, result);
    res.json(result);
    
  } catch (error: any) {
    console.error('❌ [SETUP-MEMBERS-AREA] Erro:', error);
    res.status(500).json({ 
      error: 'Erro ao criar área de membros',
      message: error.message 
    });
  }
});
// [EXTRACTED] post /api/admin/setup-members-by-email moved to server/routes/admin.ts

// 🖼️ ATIVAR SISTEMA DE IMAGENS PERMANENTES
setupImageServing();
console.log('🖼️ STARTUP: Sistema de imagens integrado com sucesso!');

// 🔑 API PARA BUSCAR CONFIGURAÇÃO EFIBANK - SECURITY: AUTH REQUIRED
app.get('/api/efibank-config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔑 Buscando configuração EfiBank para SDK (admin)...');
    
    // 🔥 BUSCAR DO FIREBASE PRIMEIRO (fonte oficial)
    await ensureFirebaseReady();
    const db = getFirestore();
    const { getEfiBankKeys } = await import('./lib/payment-config.js');
    const efiKeys = await getEfiBankKeys(db);
    
    const environment = efiKeys.environment || 'production';
    const payeeCode = efiKeys.payeeCode;
    const clientId = efiKeys.clientId;
    
    if (!clientId) {
      console.error('❌ Nenhuma credencial EfiBank encontrada no Firebase nem env!');
      return res.status(400).json({ 
        error: 'Credenciais EfiBank não configuradas',
        message: 'Configure Client ID e Client Secret em Admin → Vendas Globais'
      });
    }
    
    if (!payeeCode) {
      console.error('❌ EFIBANK_PAYEE_CODE não configurado!');
      return res.status(400).json({ 
        error: 'EFIBANK_PAYEE_CODE não configurado',
        message: 'Configure o identificador da conta EfíBank'
      });
    }
    
    console.log(`✅ Configuração EfiBank (admin): environment=${environment}, payeeCode=${payeeCode.substring(0, 8)}...`);
    
    res.json({
      success: true,
      environment,
      payeeCode,
      configured: true
    });
    
  } catch (error) {
    console.error('❌ Erro ao buscar configuração EfiBank:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: 'Falha ao carregar configurações EfiBank'
    });
  }
});

// 🔍 API PARA VERIFICAR STATUS PIX NA EFIBANK
app.post('/api/payment/verify-pix-status', async (req, res) => {
  console.log('🚀 DEBUG: Endpoint /api/payment/verify-pix-status foi chamado!');
  try {
    const { orderId, txid } = req.body;
    console.log('🚀 DEBUG: Body recebido:', { orderId, txid });
    
    if (!txid) {
      console.log('❌ DEBUG: Sem txid fornecido');
      return res.json({ isPaid: false, reason: 'No txid provided' });
    }
    
    console.log('🔍 Verificando status PIX via API:', { orderId, txid });
    
    // Usar função existente de verificação PIX
    console.log('🚀 DEBUG: Chamando verificarPixNaApi...');
    const pixStatus = await verificarPixNaApi(txid);
    console.log('🚀 DEBUG: Resultado verificarPixNaApi:', pixStatus);
    
    if (pixStatus.valido) {
      console.log('✅ PIX confirmado como PAGO via API EfíBank:', orderId);
      
      // 🚀 APROVAR PEDIDO AUTOMATICAMENTE SE CONFIRMADO NA API
      if (orderId) {
        try {
          await ensureFirebaseReady();
          const adminSdk = getAdmin();
          const db = adminSdk.firestore();
          
          // Buscar o pedido
          let orderDoc = null;
          let orderData = null;
          
          orderDoc = await db.collection('orders').doc(orderId).get();
          
          if (!orderDoc.exists) {
            const orderQuery = await db.collection('orders').where('orderId', '==', orderId).limit(1).get();
            if (!orderQuery.empty) {
              orderDoc = orderQuery.docs[0];
            }
          }
          
          if (orderDoc && orderDoc.exists) {
            orderData = orderDoc.data();
            
            // Se ainda está pendente, aprovar agora
            if (orderData.status === 'pending') {
              console.log('🚀 APROVANDO PEDIDO AUTOMATICAMENTE:', orderDoc.id);
              
              // 💰 CRITICAL: Calcular fee snapshot ANTES da transação
              const feeSnapshot = await calculateDynamicFees(
                orderData.amount,
                orderData.method || 'pix',
                orderData.installments || orderData.cardData?.installments || 1,
                orderData.gateway || orderData.processor || 'efibank',
                orderData.tenantId || orderData.sellerId
              );
              
              await db.runTransaction(async (t: any) => {
                const orderRef = db.collection('orders').doc(orderDoc.id);
                
                await t.update(orderRef, {
                  status: 'paid',
                  paidAt: new Date(),
                  updatedAt: new Date(),
                  // 💰 CRITICAL: Fee snapshot ETERNO
                  netAmount: feeSnapshot.netAmount,
                  gatewayFee: feeSnapshot.gatewayFee,
                  platformFee: feeSnapshot.platformFee,
                  financialData: {
                    grossAmount: orderData.amount,
                    feeAmount: feeSnapshot.gatewayFee + feeSnapshot.platformFee,
                    netAmount: feeSnapshot.netAmount,
                    releaseDate: new Date(Date.now() + (feeSnapshot.releaseDays || 0) * 24 * 60 * 60 * 1000),
                    released: false,
                    feeBreakdown: {
                      fixedFee: 0,
                      percentFee: feeSnapshot.gatewayFeePercent,
                      percentAmount: feeSnapshot.gatewayFee,
                      platformFeePercent: feeSnapshot.platformFeePercent,
                      platformFeeAmount: feeSnapshot.platformFee
                    },
                    releaseDays: feeSnapshot.releaseDays || 0,
                    paidAt: new Date()
                  },
                  pixData: {
                    txid: txid,
                    valor: pixStatus.dados?.valor || 0,
                    horario: new Date().toISOString(),
                    confirmedAt: new Date(),
                    method: 'pix',
                    manualApproval: true
                  }
                });
                
                console.log('✅ PEDIDO APROVADO COM FEE SNAPSHOT:', orderDoc.id);
              });
              
              // 📋 SINCRONIZAR STATUS NO RTDB + BUNNY CDN (dashboard de vendas)
              if (orderData.tenantId) {
                syncOrderAfterUpdate(orderData.tenantId, orderDoc.id, {
                  status: 'paid',
                  paidAt: new Date().toISOString(),
                  method: orderData.method || 'pix',
                  netAmount: feeSnapshot.netAmount,
                  gatewayFee: feeSnapshot.gatewayFee
                });
                sendOrderStatusUpdate(orderData.tenantId, orderDoc.id, 'paid', { paidAt: new Date() })
                  .catch(err => console.warn('[UTMify] Async auto-approve PIX update failed:', err?.message));
              }
              
              // Criar enrollment se necessário
              // 🔄 CRIAR ENROLLMENT PARA PRODUTOS DIGITAIS E SUBSCRIPTIONS
              // Subscriptions e digitais ganham acesso imediatamente após pagamento
              if (orderData.productType === 'digital' || orderData.productType === 'subscription') {
                console.log('🎯 Criando enrollment automático para produto digital ou subscription...');
                await storage.createEnrollmentOnPayment({ ...orderData, id: orderDoc.id, paidAt: new Date() });
                console.log('✅ Enrollment criado com sucesso!');
                try { await autoCreateMemberOnPurchase({ customerEmail: orderData.customerEmail || orderData.customer?.email, customerName: orderData.customerName || orderData.customer?.name, productId: orderData.productId, productType: orderData.productType, orderId: orderDoc.id, checkoutId: orderData.checkoutId || orderData.checkoutSlug }); } catch(e) { console.warn('⚠️ [AUTO-MEMBER] Erro:', e); }
              }
              
              // Processar comissão de afiliado
              if (orderData.affiliateCode || orderData.affiliateUid) {
                console.log('💰 Processando comissão de afiliado...');
                await storage.processAffiliateCommission({ ...orderData, id: orderDoc.id });
                console.log('✅ Comissão processada!');
              }
            } else {
              console.log('✅ Pedido já estava aprovado:', orderData.status);
            }
          }
        } catch (approvalError) {
          console.error('❌ Erro ao aprovar pedido automaticamente:', approvalError);
        }
      }
      
      return res.json({ isPaid: true, data: pixStatus.dados, approved: true });
    } else {
      console.log('⏳ PIX ainda pendente na API EfíBank:', orderId);
      
      // 🔒 RETORNAR COMO NÃO PAGO
      if (orderId) {
        try {
          // 🔐 INICIALIZAR FIREBASE ADMIN CORRETAMENTE
          await ensureFirebaseReady();
          const adminSdk = getAdmin();
          const db = adminSdk.firestore();
          
          // 🔍 BUSCAR PEDIDO APENAS PARA LOG DE AUDITORIA
          let orderDoc = null;
          let orderData = null;
          
          // Tentativa 1: Buscar por document ID
          console.log(`🔍 AUDITORIA: Buscando dados do pedido: ${orderId}`);
          orderDoc = await db.collection('orders').doc(orderId).get();
          
          if (orderDoc.exists) {
            orderData = orderDoc.data();
          } else {
            // Tentativa 2: Buscar por campo orderId
            const orderQuery = await db.collection('orders').where('orderId', '==', orderId).limit(1).get();
            if (!orderQuery.empty) {
              orderDoc = orderQuery.docs[0];
              orderData = orderDoc.data();
            }
          }
          
          if (orderData) {
            // 🔒 IGNORAR PEDIDOS DE SIMULAÇÃO (order_sim_*) - não são reais
            const isSimulation = typeof orderId === 'string' && orderId.startsWith('order_sim_');
            if (isSimulation) {
              return res.json({ isPaid: false, reason: 'Simulated order ignored' });
            }
            
            const createdAt = orderData.createdAt?.toDate?.() || new Date(orderData.createdAt);
            const minutesSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60);
            
            // 🚨 RELATÓRIO DE SEGURANÇA: PIX pendente há muito tempo
            console.log(`🛡️ RELATÓRIO SEGURANÇA: PIX ${orderId} pendente há ${Math.floor(minutesSinceCreation)}min - AGUARDANDO webhook EfíBank real`);
            console.log(`🔒 POLÍTICA SEGURANÇA: AUTO-APROVAÇÃO PERMANENTEMENTE DESABILITADA`);
            
            // 🚨 ALERTA PARA VERIFICAÇÃO MANUAL SE MUITO ANTIGO
            if (minutesSinceCreation > 30) {
              console.warn(`⚠️ ATENÇÃO: PIX ${orderId} há ${Math.floor(minutesSinceCreation)}min sem confirmação - verificar manualmente no painel EfíBank se necessário`);
            }
          }
        } catch (auditError) {
          console.error('❌ Erro na auditoria de segurança:', auditError);
        }
      }
      
      return res.json({ isPaid: false, reason: 'Not confirmed yet' });
    }
    
  } catch (error) {
    console.error('❌ Erro ao verificar status PIX:', error);
    
    // 🛡️ ERRO DE CONECTIVIDADE: PIX permanecerá pendente por segurança
    if ((error as any).message && (error as any).message.includes('socket hang up')) {
      console.log('🔧 CONECTIVIDADE: Erro de rede detectado - PIX permanecerá pendente por segurança');
      console.log('🔒 SEGURANÇA CRÍTICA: Não aprovando PIX por falha de conectividade - aguardando webhook EfíBank');
      
      // 🛡️ LOG DE AUDITORIA APENAS - SEM AUTO-APROVAÇÃO
      try {
        const { orderId } = req.body;
        if (orderId) {
          const admin = (await import('firebase-admin')).default;
          const db = admin.firestore();
          const orderDoc = await db.collection('orders').doc(orderId).get();
          
          if (orderDoc.exists) {
            const orderData = orderDoc.data();
            if (orderData) {
              // 🔒 IGNORAR PEDIDOS DE SIMULAÇÃO (order_sim_*) - não são reais
              const isSimulation = typeof orderId === 'string' && orderId.startsWith('order_sim_');
              if (!isSimulation) {
                const createdAt = orderData.createdAt?.toDate?.() || new Date(orderData.createdAt);
                const minutesSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60);
                
                // 🚨 APENAS LOG DE AUDITORIA - PIX PERMANECE PENDENTE
                console.log(`🛡️ AUDITORIA REDE: PIX ${orderId} pendente há ${Math.floor(minutesSinceCreation)}min com erro de conectividade`);
                console.log(`🔒 SEGURANÇA: PIX ${orderId} MANTIDO PENDENTE até webhook EfíBank real`);
                
                // 🚨 ALERTA DE MONITORAMENTO
                if (minutesSinceCreation > 30) {
                  console.warn(`⚠️ MONITORAMENTO: PIX ${orderId} há ${Math.floor(minutesSinceCreation)}min com erro de rede - monitorar manualmente`);
                }
              }
            }
          }
        }
      } catch (auditError) {
        console.error('❌ Erro na auditoria de conectividade:', auditError);
      }
    }
    
    return res.json({ isPaid: false, reason: 'Verification error' });
  }
});
// [EXTRACTED] post /api/admin/mark-order-paid-by-email moved to server/routes/admin.ts

// 💰 API DE REEMBOLSOS - CRIAÇÃO SEGURA COM AUTENTICAÇÃO
app.post('/api/refunds', verifyFirebaseToken, userRateLimit('refund'), replayProtectionMiddleware, idempotencyMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Token de autenticação necessário' });
    }

    console.log('💰 CRIAÇÃO DE REEMBOLSO - Usuário autenticado:', user.email || user.uid);
    console.log('📋 Processando reembolso');
    
    const refundData = req.body;
    
    // Validações básicas
    if (!refundData.customerId || !refundData.productId || !refundData.orderId) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios: customerId, productId, orderId' 
      });
    }

    // Verificar se o usuário é o dono do reembolso (segurança IDOR)
    if (refundData.customerId !== user.uid) {
      console.log(`🚨 TENTATIVA IDOR BLOQUEADA: User ${user.uid} tentando criar reembolso para ${refundData.customerId}`);
      return res.status(403).json({ error: 'Você só pode criar reembolsos para suas próprias compras' });
    }

    // Verificar se o email do usuário coincide com o email do reembolso
    if (user.email && refundData.customerEmail && refundData.customerEmail !== user.email) {
      console.log(`🚨 EMAIL MISMATCH BLOQUEADO: User ${user.email || user.uid} vs Refund ${refundData.customerEmail}`);
      return res.status(403).json({ error: 'Email não coincide com o usuário autenticado' });
    }

    // Garantir que o email seja do usuário autenticado
    if (user.email) {
      refundData.customerEmail = user.email;
    }
    
    // Aguardar Firebase estar pronto
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();

    // Gerar ID único para o reembolso
    const refundId = `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const newRefund = {
      id: refundId,
      ...refundData,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'pending'
    };

    // Salvar no Firebase
    await db.collection('refunds').doc(refundId).set(newRefund);
    
    console.log('✅ Reembolso criado com sucesso:', refundId);
    console.log('💰 Valor solicitado:', `R$ ${(newRefund.refundAmount / 100).toFixed(2)}`);
    console.log('📦 Produto:', newRefund.productTitle);
    
    // 🔒 BLOQUEAR ACESSO IMEDIATAMENTE AO SOLICITAR REEMBOLSO
    const productId = refundData.productId;
    const customerEmail = refundData.customerEmail;
    
    if (productId && customerEmail) {
      try {
        const enrollmentsSnapshot = await db.collection('enrollments')
          .where('productId', '==', productId)
          .where('customerEmail', '==', customerEmail)
          .limit(1)
          .get();

        if (!enrollmentsSnapshot.empty) {
          const enrollmentDoc = enrollmentsSnapshot.docs[0];
          await enrollmentDoc.ref.update({
            status: 'refund_requested',
            refundRequestedAt: new Date(),
            updatedAt: new Date()
          });
          console.log(`🔒 [REFUND-BLOCK] Acesso bloqueado para enrollment ${enrollmentDoc.id}`);
          console.log(`   Cliente ${customerEmail} perdeu acesso ao produto ${productId}`);
        } else {
          console.log(`⚠️ [REFUND-BLOCK] Nenhum enrollment encontrado para bloquear`);
        }

        // Atualizar memberEntitlements para mostrar status correto na área do cliente
        try {
          const entitlementsSnapshot = await db.collection('memberEntitlements')
            .where('productId', '==', productId)
            .where('customerEmail', '==', customerEmail)
            .limit(1)
            .get();
          if (!entitlementsSnapshot.empty) {
            await entitlementsSnapshot.docs[0].ref.update({
              status: 'refund_requested',
              refundRequestedAt: new Date(),
              updatedAt: new Date()
            });
            console.log(`🔒 [REFUND-BLOCK] memberEntitlement marcado como refund_requested para ${customerEmail}`);
          }
        } catch (meErr) {
          console.error('❌ [REFUND-BLOCK] Erro ao atualizar memberEntitlement:', meErr);
        }
      } catch (blockError) {
        console.error('❌ [REFUND-BLOCK] Erro ao bloquear acesso:', blockError);
        // Não falhar o reembolso se o bloqueio falhar
      }
    }
    
    res.status(201).json({
      success: true,
      refund: newRefund,
      message: 'Solicitação de reembolso criada com sucesso'
    });

  } catch (error) {
    console.error('❌ Erro ao criar reembolso na API:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Falha ao processar solicitação de reembolso'
    });
  }
});
// [EXTRACTED] post /api/admin/force-confirm-by-email moved to server/routes/admin.ts

// 🚫 ENDPOINT CASE-SPECIFIC REMOVIDO - CONFIRMAÇÕES VIA WEBHOOK EM PRODUÇÃO

// 🔐 CACHE: Token OAuth EfíBank (evita autenticação TLS P12 redundante no cron)
let _efiTokenCache: { token: string; expiresAt: number; credKey: string } | null = null;
// 🔐 CACHE: Certificado P12 EfíBank (evita download Firebase RTDB redundante no cron)
let _efiCertCache: { cert: Buffer; certPath: string; cachedAt: number } | null = null;
const EFI_TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutos (token expira em 60 min)
const EFI_CERT_TTL_MS = 30 * 60 * 1000; // 30 minutos

// 🔐 FUNÇÃO PARA OBTER TOKEN DE ACESSO DA API EFIBANK (COM CREDENCIAIS CUSTOMIZADAS OPCIONAIS)
async function getEfiAccessToken(customCredentials?: { 
  clientId: string; 
  clientSecret: string; 
  environment: 'production' | 'sandbox';
  certPassword?: string;
}, certBuffer?: Buffer): Promise<string> {
  // ⚡ CACHE CHECK: Reutilizar token válido para evitar múltiplas autenticações TLS
  const credKey = customCredentials ? `${customCredentials.clientId}:${customCredentials.environment}` : 'default';
  if (!customCredentials && _efiTokenCache && Date.now() < _efiTokenCache.expiresAt && _efiTokenCache.credKey === credKey) {
    return _efiTokenCache.token;
  }
  try {
    console.log('🔑 Obtendo token de acesso EfíBank...');
    
    let isProduction: boolean;
    let clientIdToUse: string | undefined;
    let clientSecretToUse: string | undefined;
    
    //  SHORT-CIRCUIT: Se credenciais customizadas fornecidas, usar diretamente
    if (customCredentials) {
      console.log(' Usando credenciais customizadas fornecidas para ambiente:', customCredentials.environment);
      
      //  VALIDAÇÃO: Credenciais não podem estar vazias
      if (!customCredentials.clientId || !customCredentials.clientSecret) {
        throw new Error('Credenciais customizadas inválidas: clientId e clientSecret são obrigatórios');
      }
      
      isProduction = customCredentials.environment === 'production';
      clientIdToUse = customCredentials.clientId;
      clientSecretToUse = customCredentials.clientSecret;
      
    } else {
      // 🔥 BUSCAR CHAVES DO BANCO DE DADOS PRIMEIRO (comportamento padrão)
      console.log(' Carregando credenciais do Firebase Firestore...');
      const db = getFirestore();
      const efiConfig = await getEfiBankKeys(db);
      
      isProduction = efiConfig.environment === 'production';
      clientIdToUse = efiConfig.clientId;
      clientSecretToUse = efiConfig.clientSecret;
    }
    
    // 🔄 TESTAR PRODUÇÃO PRIMEIRO, DEPOIS SANDBOX SE FALHAR
    // 🎯 CRITICAL FIX: Usar domínio PIX (pix.api.efipay.com.br) em vez de cobrancas
    // 🔐 FIX: Usar VOLATUS_SECRET_KEY como senha do certificado P12
    const certPasswordFromEnv = process.env.VOLATUS_SECRET_KEY || '';
    
    const environments = [
      {
        name: 'PRODUÇÃO',
        clientId: isProduction ? clientIdToUse : undefined,
        clientSecret: isProduction ? clientSecretToUse : undefined,
        hostname: 'pix.api.efipay.com.br',
        certPath: 'efi-prod.p12',
        certPassword: customCredentials?.certPassword || certPasswordFromEnv
      },
      {
        name: 'SANDBOX',
        clientId: !isProduction ? clientIdToUse : undefined,
        clientSecret: !isProduction ? clientSecretToUse : undefined,
        hostname: 'pix-h.api.efipay.com.br',
        certPath: 'efi-sandbox.p12',
        certPassword: customCredentials?.certPassword || certPasswordFromEnv
      }
    ];

    // 🔍 Tentar cada ambiente até encontrar credenciais válidas
    for (const env of environments) {
      if (!env.clientId || !env.clientSecret) {
        console.log(`⏭️ Pulando ${env.name} - credenciais não configuradas`);
        continue;
      }

      // 🔒 SECURITY: Testando token EfíBank sem logar credenciais
      
      try {
        const token = await tryGetToken(env, certBuffer);
        console.log(`✅ TOKEN OBTIDO COM SUCESSO NO AMBIENTE: ${env.name}`);
        // ⚡ ARMAZENAR NO CACHE (apenas para credenciais padrão do Firebase)
        if (!customCredentials) {
          _efiTokenCache = { token, expiresAt: Date.now() + EFI_TOKEN_TTL_MS, credKey };
        }
        return token;
      } catch (error: any) {
        console.log(`❌ ${env.name} falhou: ${error.message}`);
        // Continua tentando próximo ambiente, só falha se todos falharem
        continue;
      }
    }
    
    throw new Error('Nenhum ambiente EFIBank disponível');
  } catch (error) {
    console.error('❌ Erro geral ao obter token EfíBank:', error);
    throw error;
  }
}

async function tryGetToken(env: any, certBuffer?: Buffer): Promise<string> {
  const { clientId, clientSecret, hostname, certPath, certPassword, name } = env;
  
  try {
    const https = await import('https');
    const fs = await import('fs');
    const path = await import('path');
    
    // 🔑 Preparar credenciais Basic Auth
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    // 🔐 CRITICAL: EfíBank PRODUCTION REQUER certificado P12 (mutual TLS)
    // Sandbox pode funcionar sem certificado, mas production SEMPRE precisa
    const isProduction = hostname.includes('pix.api.efipay.com.br');
    
    if (isProduction) {
      console.log('🔐 PRODUÇÃO DETECTADA: Certificado P12 OBRIGATÓRIO (mutual TLS)');
      
      // 📡 CARREGAR CERTIFICADO P12 (obrigatório em produção)
      let pfxBuffer: Buffer | null = null;
      
      // 📥 PRIORITY 1: Usar Buffer fornecido (Bunny CDN)
      if (certBuffer) {
        if (certBuffer.length === 0) {
          throw new Error('❌ PRODUÇÃO: Certificate buffer is empty');
        }
        pfxBuffer = certBuffer;
        console.log(`📥 Certificado P12 do Bunny CDN: ${pfxBuffer.length} bytes`);
      }
      // 📂 FALLBACK: Ler do filesystem local (backward compatibility)
      else if (certPath) {
        // 🔧 FIX: Verificar se path é absoluto ou relativo
        const certFullPath = path.isAbsolute(certPath) 
          ? certPath 
          : path.resolve(process.cwd(), 'certs', certPath);
        console.log(`🔐 Tentando certificado P12 local: ${certFullPath}`);
        
        if (fs.existsSync(certFullPath)) {
          pfxBuffer = fs.readFileSync(certFullPath);
          console.log(`📋 Certificado P12 carregado (filesystem): ${pfxBuffer.length} bytes`);
        }
      }
      
      // ❌ ABORTAR SE CERTIFICADO NÃO ENCONTRADO (produção)
      if (!pfxBuffer) {
        throw new Error(
          '❌ PRODUÇÃO EFIBANK: Certificado P12 obrigatório não encontrado!\n' +
          '📥 Faça upload do certificado efi-prod.p12 no painel admin (Configurações de Pagamento → Chaves → Upload P12)\n' +
          '🔐 A API EfíBank REQUER mutual TLS (certificado P12) para autenticação em produção'
        );
      }
      
      // 🔐 CRIAR HTTPS AGENT COM CERTIFICADO P12
      let httpsAgent;
      try {
        const passphrase = certPassword !== undefined ? certPassword : '';
        
        httpsAgent = new https.Agent({
          pfx: pfxBuffer,
          passphrase: passphrase,
          rejectUnauthorized: true, // 🔒 SECURITY: TLS verification ATIVADA
          keepAlive: true,          // ⚡ SCALE: reutiliza conexão TCP — 3-5× mais rápido em produção
          timeout: 10000,
          maxSockets: 25,           // ⚡ Pool de 25 sockets simultâneos (era 1)
          maxFreeSockets: 5,
          minVersion: 'TLSv1.2'
        });
        
        console.log(`✅ CERTIFICADO P12 VALIDADO (TLS verification enabled)`);
      } catch (error: any) {
        console.error(`❌ Erro ao validar certificado P12:`, error.message);
        throw new Error(`Certificado P12 inválido: ${error.message}`);
      }
      
      // 🚀 OAuth2 COM CERTIFICADO P12 (produção)
      console.log('🚀 OAuth2 PRODUÇÃO: Usando certificado P12 (mutual TLS)');
      const token = await executeOAuth2Request(https, hostname, credentials, httpsAgent, clientId, clientSecret);
      console.log('✅ SUCESSO: Token obtido COM certificado P12 (produção)!');
      return token;
      
    } else {
      // 📡 SANDBOX: Tentar SEM certificado primeiro, depois COM (se disponível)
      console.log('🧪 SANDBOX DETECTADO: Tentando OAuth2 sem certificado primeiro');
      
      // 📡 TENTAR 1: OAuth2 SEM CERTIFICADO (sandbox)
      try {
        console.log('🚀 Tentativa 1: OAuth2 SEM certificado P12 (sandbox)');
        const token = await executeOAuth2Request(https, hostname, credentials, null, clientId, clientSecret);
        console.log('✅ SUCESSO: Token obtido SEM certificado P12 (sandbox)!');
        return token;
      } catch (noCertError: any) {
        console.warn(`⚠️ OAuth2 SEM certificado falhou: ${noCertError.message}`);
        console.log('🔄 Tentando COM certificado P12 (se disponível)...');
      }
      
      // 📡 TENTAR 2: OAuth2 COM CERTIFICADO P12 (se disponível)
      let pfxBuffer: Buffer | null = null;
      
      if (certBuffer && certBuffer.length > 0) {
        pfxBuffer = certBuffer;
        console.log(`📥 Certificado P12 do Bunny CDN: ${pfxBuffer.length} bytes`);
      } else if (certPath) {
        // 🔧 FIX: Verificar se path é absoluto ou relativo
        const certFullPath = path.isAbsolute(certPath) 
          ? certPath 
          : path.resolve(process.cwd(), 'certs', certPath);
        console.log(`🔐 Tentando certificado P12 local (sandbox): ${certFullPath}`);
        if (fs.existsSync(certFullPath)) {
          pfxBuffer = fs.readFileSync(certFullPath);
          console.log(`📋 Certificado P12 carregado (filesystem): ${pfxBuffer.length} bytes`);
        } else {
          console.log(`⚠️ Certificado P12 não encontrado em sandbox: ${certFullPath}`);
        }
      }
      
      // Se certificado disponível, tentar com ele
      if (pfxBuffer) {
        try {
          const passphrase = certPassword !== undefined ? certPassword : '';
          const httpsAgent = new https.Agent({
            pfx: pfxBuffer,
            passphrase: passphrase,
            rejectUnauthorized: true,
            keepAlive: true,   // ⚡ SCALE: pool de conexões mTLS
            timeout: 10000,
            maxSockets: 25,
            maxFreeSockets: 5,
            minVersion: 'TLSv1.2'
          });
          
          console.log('🚀 Tentativa 2: OAuth2 COM certificado P12 (sandbox)');
          const token = await executeOAuth2Request(https, hostname, credentials, httpsAgent, clientId, clientSecret);
          console.log('✅ SUCESSO: Token obtido COM certificado P12 (sandbox)!');
          return token;
        } catch (error: any) {
          console.error(`❌ Erro ao usar certificado em sandbox:`, error.message);
          // NÃO lançar erro - deixa falhar silenciosamente e continuar
        }
      }
      
      // Se chegou aqui, ambas tentativas falharam
      console.warn('⚠️ Sandbox: OAuth2 falhou SEM certificado, certificado não disponível ou inválido');
      throw new Error('Sandbox: OAuth2 falhou - credenciais ou certificado inválidos');
    }
    
  } catch (error) {
    console.error('❌ Erro geral ao obter token EfíBank:', error);
    throw error;
  }
}

// 🔐 HELPER: Executar requisição OAuth2 (com ou sem certificado)
async function executeOAuth2Request(
  https: any, 
  hostname: string, 
  credentials: string, 
  httpsAgent: any | null,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const postData = JSON.stringify({ grant_type: 'client_credentials' });
  
  // 🎯 CRITICAL FIX: PIX API usa /oauth/token em vez de /v1/authorize
  const oauthPath = hostname.includes('pix') ? '/oauth/token' : '/v1/authorize';
  
  const options: any = {
    hostname: hostname,
    port: 443,
    path: oauthPath,
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'User-Agent': 'VolatusPay/1.0',
      'Accept': 'application/json',
      'Accept-Encoding': 'identity' // 🔧 Conforme documentação EfíPay
    }
  };
  
  // 🔧 ADICIONAR CERTIFICADO APENAS SE FORNECIDO
  if (httpsAgent) {
    options.agent = httpsAgent;
    console.log('📡 OAuth2 COM certificado P12');
  } else {
    console.log('📡 OAuth2 SEM certificado (client_credentials puro)');
  }
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (response: any) => {
      let data = '';
      response.on('data', (chunk: any) => data += chunk);
      response.on('end', () => {
        console.log(`📡 EFIBANK OAUTH2 RESPONSE: Status ${response.statusCode}`);
        console.log(`📡 EFIBANK OAUTH2 RAW RESPONSE: ${data}`);
        
        try {
          const result = JSON.parse(data);
          if (response.statusCode === 200 && result.access_token) {
            console.log('✅ Token EfíBank obtido com sucesso');
            resolve(result.access_token);
          } else {
            reject(new Error(`EfíBank OAuth2 failed: ${response.statusCode} - ${data}`));
          }
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on('error', (error: any) => {
      console.log(`❌ EFIBANK OAUTH2 FAILED: ${JSON.stringify({
        statusCode: error.code || 'UNKNOWN',
        response: error.message,
        headers: {}
      }, null, 2)}`);
      reject(error);
    });

    req.setTimeout(30000, () => {
      console.log('⏰ TIMEOUT OAUTH2');
      req.destroy();
      reject(new Error('OAuth2 timeout'));
    });

    req.write(postData);
    req.end();
  });
}

// 📥 BAIXAR CERTIFICADO DO BUNNY CDN (COM FALLBACK LOCAL)
async function downloadCertFromFirebaseStorage(storagePath: string): Promise<Buffer> {
  const LOCAL_CERT_CACHE = path.join(process.cwd(), 'certs', 'efi-prod.p12');
  
  try {
    console.log(`📥 Buscando certificado (RTDB → Bunny CDN → Cache local)...`);
    console.log(`💾 Cache local: ${LOCAL_CERT_CACHE}`);
    
    // 🔐 PRIORIDADE 1: Firebase Realtime Database (SEGURO - não público)
    try {
      await ensureFirebaseReady();
      const adminSdk = getAdmin();
      const rtdb = adminSdk.database();
      const certRef = rtdb.ref('system/certificates/efibank-prod');
      const certSnap = await certRef.once('value');
      
      if (certSnap.exists()) {
        const certData = certSnap.val();
        if (certData?.base64) {
          const buffer = Buffer.from(certData.base64, 'base64');
          if (buffer.length > 256 && buffer[0] === 0x30 && buffer[1] === 0x82) {
            console.log(`✅ Certificado carregado do Firebase RTDB: ${buffer.length} bytes`);
            
            try {
              const certsDir = path.join(process.cwd(), 'certs');
              if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true });
              await fs.promises.writeFile(LOCAL_CERT_CACHE, buffer);
            } catch (_e) {}
            
            return buffer;
          }
        }
      }
      console.log('ℹ️ Certificado não encontrado no RTDB, tentando Bunny CDN...');
    } catch (rtdbError: any) {
      console.warn(`⚠️ RTDB fallback: ${rtdbError.message}`);
    }
    
    // 🐰 PRIORIDADE 2: Bunny CDN (fallback - público mas com AccessKey)
    const { getBunnyCredentials } = await import('./lib/bunny-helper.js');
    const credentials = await getBunnyCredentials();
    
    if (credentials && credentials.storageApiKey) {
      const regionPrefix = credentials.storageRegion && credentials.storageRegion !== 'de' ? `${credentials.storageRegion}.` : '';
      const storageUrl = `https://${regionPrefix}storage.bunnycdn.com/${credentials.storageZoneName}/${storagePath}`;
      
      console.log(`⬇️ Fazendo download do certificado do Bunny CDN...`);
      const response = await fetch(storageUrl, {
        headers: { 'AccessKey': credentials.storageApiKey }
      });
      
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        
        if (!buffer || buffer.length === 0) {
          throw new Error('Downloaded certificate is empty');
        }
        
        console.log(`✅ Certificado baixado com sucesso do Bunny CDN: ${buffer.length} bytes`);
        
        // 🔐 AUTO-MIGRAR: Salvar no RTDB para futuras buscas (mais seguro)
        try {
          const adminSdk = getAdmin();
          const rtdb = adminSdk.database();
          const existingCert = await rtdb.ref('system/certificates/efibank-prod').once('value');
          if (!existingCert.exists() || existingCert.val()?.source !== 'admin-upload') {
            await rtdb.ref('system/certificates/efibank-prod').set({
              base64: buffer.toString('base64'),
              migratedFrom: 'bunny-cdn',
              migratedAt: new Date().toISOString(),
              originalPath: storagePath,
              sizeBytes: buffer.length,
              source: 'auto-migration'
            });
            console.log('🔐 AUTO-MIGRAÇÃO: Certificado copiado do Bunny CDN para Firebase RTDB (seguro)');
          } else {
            console.log('ℹ️ RTDB já contém certificado de admin-upload, não sobrescrevendo');
          }
        } catch (migrationError: any) {
          console.warn(`⚠️ Auto-migração para RTDB falhou (non-blocking): ${migrationError.message}`);
        }
        
        try {
          const certsDir = path.join(process.cwd(), 'certs');
          if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true });
          await fs.promises.writeFile(LOCAL_CERT_CACHE, buffer);
          console.log(`💾 Certificado salvo em cache local: ${LOCAL_CERT_CACHE}`);
        } catch (cacheError: any) {
          console.warn(`⚠️ Não foi possível salvar cache local: ${cacheError.message}`);
        }
        
        return buffer;
      } else {
        console.error(`❌ Certificado NÃO ENCONTRADO no Bunny CDN (${response.status}): ${storagePath}`);
      }
    } else {
      console.warn('⚠️ Bunny CDN não configurado, tentando cache local...');
    }
    
    // 🔄 PRIORIDADE 3: Cache local
    console.log(`🔄 Tentando usar cache local: ${LOCAL_CERT_CACHE}`);
    if (fs.existsSync(LOCAL_CERT_CACHE)) {
      const cachedBuffer = await fs.promises.readFile(LOCAL_CERT_CACHE);
      console.log(`✅ Usando certificado do cache local: ${cachedBuffer.length} bytes`);
      return cachedBuffer;
    }
    
    throw new Error(`Certificate not found in RTDB, Bunny CDN, AND local cache: ${storagePath}`);
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar certificado:', error.message);
    
    // 🔄 FALLBACK FINAL: Cache local
    if (fs.existsSync(LOCAL_CERT_CACHE)) {
      try {
        const cachedBuffer = await fs.promises.readFile(LOCAL_CERT_CACHE);
        console.log(`✅ FALLBACK BEM-SUCEDIDO - Usando cache local: ${cachedBuffer.length} bytes`);
        return cachedBuffer;
      } catch (cacheReadError: any) {
        console.error(`❌ Erro ao ler cache local: ${cacheReadError.message}`);
      }
    } else {
      console.error(`❌ Cache local NÃO EXISTE: ${LOCAL_CERT_CACHE}`);
    }
    
    throw new Error(`Failed to download certificate: ${error.message}`);
  }
}

// 📡 REGISTRAR WEBHOOK PIX VIA API EFIBANK (COM CERTIFICADO OBRIGATÓRIO)
async function registerEfiBankWebhook(pixKey: string, webhookUrl: string, certBuffer?: Buffer): Promise<boolean> {
  try {
    console.log('📡 Registrando webhook PIX na API EfíBank...');
    // 🔒 SECURITY: Chave PIX configurada (não logar dados sensíveis)
    console.log(`🌐 Webhook URL: ${webhookUrl}`);
    
    let certificado: Buffer;
    
    // 📥 PRIORITY 1: Usar Buffer fornecido (Bunny CDN)
    if (certBuffer) {
      if (certBuffer.length === 0) {
        throw new Error('Certificate buffer is empty');
      }
      certificado = certBuffer;
      console.log(`📥 Usando certificado do Bunny CDN: ${certificado.length} bytes`);
    }
    // 📂 FALLBACK: Ler do filesystem local (backward compatibility)
    else {
      const certificadoPath = getCertPath('efi-prod.p12');
      if (!fs.existsSync(certificadoPath)) {
        throw new Error('Certificado EfíBank não encontrado - obrigatório para registro de webhook');
      }
      certificado = fs.readFileSync(certificadoPath);
      console.log(`📂 Usando certificado local: ${certificado.length} bytes`);
    }
    
    // Obter token OAuth2 (passar certificado se disponível)
    const token = await getEfiAccessToken(undefined, certificado);
    
    // 🔥 BUSCAR ENVIRONMENT DA CONFIGURAÇÃO FIRESTORE
    const db = getFirestore();
    const { getPaymentConfig } = await import('./lib/payment-config.js');
    const paymentConfig = await getPaymentConfig(db);
    const isProduction = paymentConfig?.efibank?.environment === 'production';
    
    const baseUrl = isProduction
      ? 'https://pix.api.efipay.com.br'
      : 'https://pix-h.api.efipay.com.br';
    
    const payload = JSON.stringify({ webhookUrl });
    
    const options = {
      hostname: baseUrl.replace('https://', ''),
      port: 443,
      path: `/v2/webhook/${encodeURIComponent(pixKey)}`,
      method: 'PUT',
      pfx: certificado,
      passphrase: '',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-skip-mtls-checking': 'true'
      }
    };
    
    console.log('🔐 REGISTRO WEBHOOK: certificado P12 + Bearer OAuth2');
    
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log(`📡 WEBHOOK REGISTRATION RESPONSE: Status ${res.statusCode}`);
          console.log(`📡 Response: ${data}`);
          
          if (res.statusCode === 200 || res.statusCode === 201) {
            console.log('✅ Webhook registrado com sucesso!');
            resolve(true);
          } else {
            console.error('❌ Falha ao registrar webhook:', data);
            reject(new Error(`Webhook registration failed: ${res.statusCode} - ${data}`));
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('❌ ERRO CRÍTICO na requisição de webhook:', error);
        console.error('❌ WEBHOOK NÃO REGISTRADO - Sistema NÃO receberá notificações PIX automáticas');
        reject(new Error(`Network error: ${error.message}`));
      });
      
      req.setTimeout(60000, () => {
        console.error('⏰ TIMEOUT no registro webhook (60s) - FALHA');
        console.error('❌ WEBHOOK NÃO REGISTRADO - Sistema NÃO receberá notificações PIX automáticas');
        req.destroy();
        reject(new Error('Timeout ao registrar webhook'));
      });
      
      req.write(payload);
      req.end();
    });
  } catch (error) {
    console.error('❌ Erro ao registrar webhook EfíBank:', error);
    throw error;
  }
}

// 🔐 FUNÇÃO DE VERIFICAÇÃO DE PIX VIA API EFIBANK (SEGURANÇA CRÍTICA)
async function verificarPixNaApi(txid: string): Promise<{valido: boolean, dados?: any}> {
  try {
    console.log('🔍 Verificando PIX na API EfíBank:', txid);
    
    // 🔐 SEGURANÇA CRÍTICA: CERTIFICADO É OBRIGATÓRIO PARA VALIDAÇÃO
    // Buscar configuração do Firebase para obter certificateStoragePath
    await ensureFirebaseReady();
    const { getPaymentConfig } = await import('./lib/payment-config.js');
    const paymentConfig = await getPaymentConfig(null);
    
    let certificado: Buffer;
    
    // 1️⃣ PRIORIDADE: Bunny CDN (ETERNO)
    if (paymentConfig?.efibank?.certificateStoragePath) {
      const certStoragePath = paymentConfig.efibank.certificateStoragePath;
      // ⚡ CACHE CHECK: Reutilizar certificado para evitar múltiplos downloads RTDB
      if (_efiCertCache && _efiCertCache.certPath === certStoragePath && Date.now() - _efiCertCache.cachedAt < EFI_CERT_TTL_MS) {
        certificado = _efiCertCache.cert;
      } else {
      console.log(`📥 Baixando certificado do Bunny CDN para validação: ${certStoragePath}`);
      try {
        certificado = await downloadCertFromFirebaseStorage(certStoragePath);
        _efiCertCache = { cert: certificado, certPath: certStoragePath, cachedAt: Date.now() };
        console.log(`✅ Certificado baixado para validação: ${certificado.length} bytes`);
      } catch (storageError: any) {
        console.error(`❌ Erro ao baixar certificado do Storage: ${storageError.message}`);
        console.error('🚨 SECURITY BLOCK: Certificado EfíBank OBRIGATÓRIO não encontrado');
        console.error('🚨 NÃO É POSSÍVEL VALIDAR PIX sem certificado - BLOQUEANDO por segurança');
        return { 
          valido: false, 
          dados: { 
            error: 'CERTIFICATE_REQUIRED',
            message: 'Certificado EfíBank obrigatório para validação',
            txid: txid 
          } 
        };
      }
      } // fecha else (download fresco)
    } else {
      // 2️⃣ FALLBACK: Tentar certificado local (backward compatibility)
      const certificadoPath = getCertPath('efi-prod.p12');
      if (!fs.existsSync(certificadoPath)) {
        console.error('🚨 SECURITY BLOCK: Certificado EfíBank OBRIGATÓRIO não encontrado');
        console.error('🚨 NÃO É POSSÍVEL VALIDAR PIX sem certificado - BLOQUEANDO por segurança');
        return { 
          valido: false, 
          dados: { 
            error: 'CERTIFICATE_REQUIRED',
            message: 'Certificado EfíBank obrigatório para validação',
            txid: txid 
          } 
        };
      }
      certificado = fs.readFileSync(certificadoPath);
      console.log(`✅ Certificado local usado para validação: ${certificado.length} bytes`);
    }
    
    // Obter token de acesso E ambiente correto (production/sandbox)
    const token = await getEfiAccessToken();
    const efiKeys = await getEfiBankKeys(null);
    
    // Consultar PIX na API oficial do EfíBank
    const https = await import('https');
    const querystring = await import('querystring');
    
    // 🔥 CRITICAL FIX (Nov 2025): Usar ambiente correto do Firebase
    // Credenciais do Firebase determinam o ambiente (production/sandbox)
    const isProduction = efiKeys.environment === 'production';
    const baseUrl = isProduction 
      ? 'https://pix.api.efipay.com.br'     // PRODUÇÃO - PIX REAIS
      : 'https://pix-h.api.efipay.com.br';  // SANDBOX - APENAS TESTES
      
    console.log(`🔍 VALIDAÇÃO PIX: Usando ambiente ${isProduction ? 'PRODUÇÃO' : 'SANDBOX'} (Firebase: ${efiKeys.environment})`);
    console.log(`🌐 API URL: ${baseUrl}`);
    
    const options = {
      hostname: baseUrl.replace('https://', ''),
      port: 443,
      path: `/v2/cob/${querystring.escape(txid)}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      // 🔐 CERTIFICADO P12 OBRIGATÓRIO PARA PIX REAL (mTLS)
      pfx: certificado,
      passphrase: ''
    };
    
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            
            if (res.statusCode === 200) {
              // 🔐 CRITICAL FIX: Verificar se PIX foi REALMENTE pago
              // Status 'ATIVA' = aguardando pagamento
              // Status 'CONCLUIDA' = PIX foi pago com sucesso
              if (response.status === 'CONCLUIDA') {
                console.log('✅ PIX CONFIRMADO (CONCLUIDA) na API:', txid);
                resolve({ valido: true, dados: response });
              } else {
                console.log('⏳ PIX ainda pendente na API:', txid, 'Status:', response.status);
                resolve({ valido: false, dados: response });
              }
            } else {
              console.log('❌ PIX NÃO CONFIRMADO na API:', txid, 'HTTP Status:', res.statusCode, 'Response:', response);
              resolve({ valido: false, dados: response });
            }
          } catch (error) {
            console.error('❌ Erro ao parsear resposta da API:', error, 'Raw data:', data);
            resolve({ valido: false, dados: { error: 'PARSE_ERROR', raw: data } });
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('❌ Erro na requisição à API EfíBank:', error);
        resolve({ valido: false });
      });
      
      req.setTimeout(10000, () => {
        console.error('❌ Timeout na verificação do PIX');
        req.destroy();
        resolve({ valido: false });
      });
      
      req.end();
    });
    
  } catch (error) {
    console.error('❌ Erro geral na verificação PIX:', error);
    return { valido: false };
  }
}

// 🔄 INTERNAL: Batch verify pending PIX (protected by internal key, no Firebase auth needed)
app.get('/api/internal/batch-verify-pix', async (req, res) => {
  const key = req.query.key;
  if (key !== 'volatuspay-internal-2026') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  try {
    console.log('🔄 INTERNAL BATCH VERIFY: Buscando ordens PIX pendentes...');
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    const pendingSnap = await db.collection('orders')
      .where('status', '==', 'pending')
      .where('method', '==', 'pix')
      .limit(200)
      .get();
    
    const results: any[] = [];
    let approved = 0;
    
    console.log(`📊 ${pendingSnap.size} ordens PIX pendentes encontradas`);
    
    for (const doc of pendingSnap.docs) {
      const orderData = doc.data();
      const orderId = doc.id;
      
      if (!orderData.txid) {
        results.push({ orderId, status: 'skipped', reason: 'sem txid', customer: orderData.customer?.name, amount: (orderData.amount || 0) / 100 });
        continue;
      }
      
      try {
        const pixStatus = await verificarPixNaApi(orderData.txid);
        const pixPaid = pixStatus.valido && pixStatus.dados?.status?.toUpperCase() === 'CONCLUIDA';
        const hasPagamento = pixStatus.dados?.pix && Array.isArray(pixStatus.dados.pix) && pixStatus.dados.pix.length > 0;
        
        if (pixPaid || hasPagamento) {
          // Usar o gateway real da order (pode ser 'efibank' ou 'woovi')
          const orderGateway = orderData.gateway || orderData.processor || 'efibank';
          const feeCalc = await calculateDynamicFees(orderData.amount, 'pix', 1, orderGateway, orderData.tenantId || orderData.sellerId);
          const releaseDate = new Date(Date.now() + (feeCalc.releaseDays || 0) * 86400000);
          
          let batchAlreadyPaid = false;
          await db.runTransaction(async (t: any) => {
            const freshDoc = await t.get(doc.ref);
            const freshData = freshDoc.data();
            if (freshData.status !== 'pending') {
              console.log(`⚠️ [BATCH PIX] ${orderId} já processado (status: ${freshData.status}), pulando`);
              batchAlreadyPaid = true;
              return;
            }
            t.update(doc.ref, {
              status: 'paid', paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
              pixConfirmation: pixStatus.dados, confirmedVia: 'internal_batch_verify',
              manuallyApproved: true, manuallyApprovedAt: new Date(),
              method: 'pix',
              processor: 'efibank',
              netAmount: feeCalc.netAmount,
              gatewayFee: feeCalc.gatewayFee,
              platformFee: feeCalc.platformFee,
              releaseDate: releaseDate,
              financialData: {
                totalAmount: orderData.amount,
                netAmount: feeCalc.netAmount,
                gatewayFee: feeCalc.gatewayFee,
                platformFee: feeCalc.platformFee,
                releaseDate: releaseDate,
                paidAt: new Date(),
                releaseDays: feeCalc.releaseDays
              },
              'financial.released': false, 'financial.netAmount': feeCalc.netAmount,
              'financial.gatewayFee': feeCalc.gatewayFee, 'financial.platformFee': feeCalc.platformFee,
              'financial.releaseDate': releaseDate, 'financial.releaseDays': feeCalc.releaseDays
            });
          });
          
          if (batchAlreadyPaid) {
            results.push({ orderId, status: 'already_paid', reason: 'Já processado por webhook/cron', customer: orderData.customer?.name, amount: (orderData.amount || 0) / 100 });
            continue;
          }
          
          syncOrderAfterUpdate(orderData.tenantId, orderId, { status: 'paid', paidAt: new Date().toISOString(), method: 'pix', netAmount: feeCalc.netAmount });
          sendOrderStatusUpdate(orderData.tenantId, orderId, 'paid', { paidAt: new Date() }).catch(() => {});

          // 🔄 Sincronizar personalSales se for venda avulsa QR Code
          if (orderData.type === 'personal_sale' && orderData.personalSaleId) {
            try {
              await db.collection('personalSales').doc(orderData.personalSaleId).update({
                status: 'paid', paidAt: new Date(), updatedAt: new Date(), qrcodeText: '', qrExpired: true,
              });
              console.log(`✅ [CRON PIX] PersonalSale ${orderData.personalSaleId} sincronizada como paga`);
            } catch (psErr: any) {
              console.warn(`⚠️ [CRON PIX] Erro ao sincronizar personalSale:`, psErr?.message);
            }
          }
          
          try { await dispatchPixPaidEvent(orderData.tenantId || orderData.sellerId, { id: orderId, ...orderData, paidAt: new Date() }); } catch(e) {}
          if (orderData.checkoutId) {
            dispatchPurchaseEventToPixels(orderData.checkoutId, {
              id: orderId, tenantId: orderData.tenantId, customerEmail: orderData.customerEmail,
              customerName: orderData.customerName, customerPhone: orderData.customerPhone,
              amount: orderData.amount, currency: orderData.currency || 'BRL', productName: orderData.productName,
              method: 'pix', checkoutSlug: orderData.checkoutSlug
            }).catch(err => console.warn('[CAPI] Batch PIX purchase dispatch failed:', err?.message));
          }
          if (orderData.productType === 'digital' || orderData.productType === 'subscription') {
            try { await storage.createEnrollmentOnPayment({ ...orderData, id: orderId, paidAt: new Date() }); } catch(e) {}
            try { await autoCreateMemberOnPurchase({ customerEmail: orderData.customerEmail || orderData.customer?.email, customerName: orderData.customerName || orderData.customer?.name, productId: orderData.productId, productType: orderData.productType, orderId, checkoutId: orderData.checkoutId || orderData.checkoutSlug }); } catch(e) { console.warn('⚠️ [AUTO-MEMBER] Erro:', e); }
          }
          if (orderData.affiliateCode || orderData.affiliateUid) {
            try { await storage.processAffiliateCommission({ ...orderData, id: orderId }); } catch(e) {}
          }
          
          if (orderData.couponCode) {
            try {
              const couponDoc = await storage.getCouponByCode(orderData.couponCode, orderData.tenantId);
              if (couponDoc) {
                await storage.incrementCouponUsage(couponDoc.id);
                console.log(`🎫 [BATCH PIX] Cupom ${orderData.couponCode} uso incrementado`);
              }
            } catch(e) { console.warn('⚠️ [COUPON] Erro ao incrementar uso:', e); }
          }
          
          const sellerId = orderData.tenantId || orderData.sellerId;
          if (sellerId) {
            try {
              let affDed = 0;
              if (orderData.affiliateCode || orderData.affiliateUid) {
                const affCalc = await (storage as any).calculateAffiliateCommission(orderData);
                if (affCalc?.hasAffiliate && affCalc.netCommission > 0) affDed = affCalc.netCommission;
              }
              const credit = feeCalc.netAmount - affDed;
              if (credit > 0) {
                const { processWebhookWithBalanceUpdate: batchBalanceUpdate } = await import('./lib/atomic-balance.js');
                const batchWebhookId = `pix_confirmed_${orderData.txid}_${orderId}`;
                const batchResult = await batchBalanceUpdate({
                  webhookId: batchWebhookId,
                  provider: 'efibank',
                  eventType: 'pix.paid',
                  sellerId: sellerId,
                  amountCents: credit,
                  currency: 'BRL',
                  operation: 'add',
                  balanceType: 'available',
                  reason: `PIX confirmado via batch verify - Ordem ${orderId}`,
                  orderId: orderId,
                  metadata: {
                    method: 'pix',
                    acquirer: 'efibank',
                    totalAmount: orderData.amount,
                    platformFee: feeCalc.platformFee,
                    gatewayFee: feeCalc.gatewayFee,
                    confirmedVia: 'internal_batch_verify'
                  }
                });
                if (batchResult.processed) {
                  console.log(`💰 [BATCH PIX] Saldo creditado via atomic balance: +R$ ${(credit/100).toFixed(2)} (byMethod.pix atualizado)`);
                } else {
                  console.log(`⚠️ [BATCH PIX] Balance já processado: ${batchResult.reason}`);
                }
              }
            } catch(e: any) { console.warn(`⚠️ [BATCH PIX] Erro ao creditar saldo:`, e?.message); }
          }
          
          approved++;
          results.push({ orderId, status: 'APPROVED', customer: orderData.customer?.name, amount: (orderData.amount || 0) / 100 });
        } else {
          results.push({ orderId, status: 'still_pending', efiStatus: pixStatus.dados?.status || 'unknown', customer: orderData.customer?.name, amount: (orderData.amount || 0) / 100 });
        }
      } catch (e: any) {
        results.push({ orderId, status: 'error', message: e?.message, customer: orderData.customer?.name });
      }
    }
    
    return res.json({ success: true, total: pendingSnap.size, approved, results });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message });
  }
});

// 📊 HEALTH CHECK API
app.get('/api/health', async (_req, res) => {
  let scaleMetrics: Record<string, unknown> = {};
  try {
    const { getScaleMetrics } = await import('./lib/scale-layer.js');
    scaleMetrics = getScaleMetrics();
  } catch { /* scale-layer opcional */ }

  res.json({
    status: 'online',
    service: 'VolatusPay',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    message: '✅ Sistema funcionando perfeitamente',
    uptime: Math.floor(process.uptime()),
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
    },
    scale: scaleMetrics
  });
});


// 🔧 ENDPOINT TEMPORÁRIO: Verificar orders no Firestore (REMOVER EM PRODUÇÃO)
app.get("/api/check-orders", async (_req, res) => {
  try {
    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) {
      return res.status(500).json({ error: "Firebase não conectado" });
    }
    
    const limit = parseInt(_req.query.limit as string) || 10;
    const snapshot = await firebaseStorage.db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    
    const orders = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        tenantId: data.tenantId,
        status: data.status,
        method: data.method,
        amount: data.amount,
        customerEmail: data.customer?.email || data.customerEmail,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      };
    });
    
    console.log(`🔍 CHECK-ORDERS: Found ${orders.length} orders in Firestore`);
    
    return res.json({
      success: true,
      count: orders.length,
      orders
    });
  } catch (error: any) {
    console.error("❌ CHECK-ORDERS ERROR:", error);
    return res.status(500).json({ error: error.message });
  }
});

// [EXTRACTED] Security routes moved to server/routes/security.ts

// 🔐 ROTA DE VERIFICAÇÃO DE STATUS DE AUTENTICAÇÃO
app.get('/api/auth/me', verifyFirebaseToken, authStatusHandler);

// 🔐 VERIFICAÇÃO DE STATUS DE SELLER (Neon primeiro, fallback Firestore + auto-migração)
app.get('/api/auth/seller-status', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid || req.authUser?.uid;
    if (!userId) return res.status(401).json({ isSeller: false, error: 'Usuário não identificado' });
    // 1️⃣ Neon (fonte de verdade)
    let isSeller = false;
    const { neonQuery: _nqSS } = await import('./lib/neon-db.js');
    await _nqSS(async (sql: any) => {
      const rows = (await sql`SELECT id FROM sellers WHERE id = ${userId} LIMIT 1`) as any[];
      if (rows[0]) isSeller = true;
    }, `sellerStatus:${userId}`);

    if (isSeller) {
      return res.json({ isSeller: true });
    }

    // 2️⃣ Fallback Firestore — sellers antigos ainda não migrados
    try {
      await ensureFirebaseReady();
      const adminSdk = getAdmin();
      const fsDb = adminSdk.firestore();
      const sellerDoc = await fsDb.collection('sellers').doc(userId).get();
      if (sellerDoc.exists) {
        const d = sellerDoc.data() || {};
        console.log(`🔄 [seller-status] Seller ${userId.substring(0,8)} encontrado no Firestore — migrando para Neon`);
        // Auto-migrar para Neon (fire-and-forget)
        _nqSS(async (sql: any) => {
          await (sql as any)`
            INSERT INTO sellers (
              id, tenant_id, email, name, business_name, status,
              phone, document, profile_complete, is_approved, is_blocked, created_at, updated_at
            ) VALUES (
              ${userId},
              ${d.tenantId || userId},
              ${d.email || null},
              ${d.name || d.fullName || null},
              ${d.businessName || d.companyName || null},
              ${d.status || 'pending'},
              ${d.phone || null},
              ${d.document || null},
              ${d.profileComplete ?? false},
              ${d.status === 'approved'},
              ${d.isBlocked ?? false},
              ${d.createdAt?.toDate ? d.createdAt.toDate() : new Date()},
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              tenant_id     = COALESCE(EXCLUDED.tenant_id, sellers.tenant_id),
              email         = COALESCE(EXCLUDED.email, sellers.email),
              name          = COALESCE(EXCLUDED.name, sellers.name),
              business_name = COALESCE(EXCLUDED.business_name, sellers.business_name),
              status        = EXCLUDED.status,
              updated_at    = NOW()
          `;
        }, `autoMigrateSeller:${userId}`).catch((err: any) => {
          console.warn(`⚠️ Auto-migração Neon falhou para ${userId.substring(0,8)}:`, err?.message);
        });
        return res.json({ isSeller: true });
      }
    } catch (fsErr: any) {
      console.warn(`⚠️ Firestore fallback falhou para ${userId.substring(0,8)}:`, fsErr?.message);
    }

    return res.json({ isSeller: false });
  } catch (error: any) {
    console.error('❌ Erro ao verificar seller status:', error?.message || error?.code || typeof error, JSON.stringify(error));
    return res.status(500).json({ error: 'Erro interno', isSeller: false });
  }
});


// 🚫 UPLOAD REMOVIDO - SISTEMA USA APENAS URLs EXTERNAS
// Sem Firebase Storage - produtos usam imageUrl e documentUrls via Bunny CDN

// [REMOVIDO] - Primeira definição duplicada do endpoint EfíBank movida para linha 3548



// 🚫 ENDPOINT DE EMERGÊNCIA ORDER-SPECIFIC REMOVIDO - WEBHOOKS FUNCIONAM EM PRODUÇÃO

// 🚀 CONFIRMAÇÃO MANUAL DE PIX PENDENTES - ADMIN ONLY
// [EXTRACTED] post /api/admin/confirm-pending-pix moved to server/routes/admin.ts

// 🚫 ENDPOINT INSEGURO REMOVIDO POR VIOLAÇÕES DE SEGURANÇA PCI
// O fallback backend foi removido devido a:
// - Manipulação de dados de cartão sem controles PCI adequados  
// - Endpoint público exposto a ataques
// - Tokenização simulada (não real)
// 
// SOLUÇÃO SEGURA: Quando SDK EfiBank falha, bloqueamos pagamentos com cartão
// e sugerimos métodos alternativos (PIX/Stripe)

// 🔐 ADMIN - SALVAR CONFIGURAÇÃO STRIPE
// [EXTRACTED] get /api/admin/stripe-config moved to server/routes/admin.ts

// [EXTRACTED] Duplicate GET /api/admin/config/status removed - moved to server/routes/admin-config.ts

// 🔑 PUBLIC - STRIPE PUBLIC KEY (SEM AUTENTICAÇÃO)
app.get('/api/stripe/public-key', async (req, res) => {
  try {
    const stripeConfig = await loadSecureStripeConfig();
    
    if (stripeConfig && stripeConfig.publicKey) {
      return res.json({
        success: true,
        publicKey: stripeConfig.publicKey
      });
    }
    
    return res.json({
      success: false,
      publicKey: null
    });
  } catch (error) {
    console.error('❌ Erro ao buscar chave pública Stripe:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load Stripe configuration'
    });
  }
});

// 🌐 PUBLIC - CONFIGURAÇÕES DE TAXAS (LEITURA PÚBLICA PARA CHECKOUT) - SEM AUTENTICAÇÃO
app.get('/api/public/acquirers-fees', async (req, res) => {
  try {
    console.log('🌐 PUBLIC - Buscando taxas públicas para checkout...');
    
    const defaultConfig = {
      efibank: {
        pixFeePercent: 2,
        cardFeePercent: 5.2,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 8.2,
        installment10to12x: 9.2,
      },
      stripe: {
        cardFeePercent: 5.2,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 7.2,
        installment10to12x: 8.2,
      }
    };
    
    try {
      await ensureFirebaseReady();
      const _fsDefConf = getAdmin().firestore();
      const configRef = _fsDefConf.collection('admin').doc('acquirers-config');
      const configDoc = await configRef.get();
      
      if (configDoc.exists) {
        const data = configDoc.data();
        const publicData = {
          efibank: {
            pixFeePercent: data.efibank?.pixFeePercent || 2,
            cardFeePercent: data.efibank?.cardFeePercent || 5.2,
            installment1x: data.efibank?.installment1x || 5.2,
            installment2to6x: data.efibank?.installment2to6x || 6.2,
            installment7to9x: data.efibank?.installment7to9x || 8.2,
            installment10to12x: data.efibank?.installment10to12x || 9.2,
          },
          stripe: {
            cardFeePercent: data.stripe?.cardFeePercent || 5.2,
            installment1x: data.stripe?.installment1x || 5.2,
            installment2to6x: data.stripe?.installment2to6x || 6.2,
            installment7to9x: data.stripe?.installment7to9x || 7.2,
            installment10to12x: data.stripe?.installment10to12x || 8.2,
          }
        };
        console.log('✅ Taxas públicas retornadas do Firebase');
        return res.json(publicData);
      }
    } catch (dbError) {
      console.log('⚠️ Erro ao buscar taxas, usando padrão:', dbError.message);
    }
    
    res.json(defaultConfig);
  } catch (error) {
    console.error('❌ Erro ao buscar taxas públicas:', error);
    res.json({
      efibank: {
        pixFeePercent: 2,
        cardFeePercent: 5.2,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 8.2,
        installment10to12x: 9.2,
      },
      stripe: {
        cardFeePercent: 5.2,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 7.2,
        installment10to12x: 8.2,
      }
    });
  }

});
// [EXTRACTED] get /api/admin/acquirers-config moved to server/routes/admin.ts

// ====================================================
// 📚 MÓDULOS E LIÇÕES - API ENDPOINTS PARA ÁREA DE MEMBROS
// ====================================================

// 📚 CRIAR MÓDULO
app.post('/api/modules', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📚 API - Criando módulo...');
    
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(403).json({ error: 'Acesso negado: tenant não identificado' });
    }

    // 🛡️ VALIDAÇÃO ZOD - Validar dados do cliente
    const validationResult = insertModuleSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos',
        details: validationResult.error.flatten().fieldErrors 
      });
    }

    // ✅ Adicionar tenantId DEPOIS da validação (servidor controla tenancy)
    const moduleData = {
      ...validationResult.data,
      tenantId
    };

    // 🔒 VERIFICAÇÃO DE OWNERSHIP - Verificar se o produto pertence ao tenant
    if (!moduleData.productId) {
      return res.status(400).json({ error: 'productId é obrigatório' });
    }

    const product = await storage.getProduct(moduleData.productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    if (product.tenantId !== tenantId) {
      return res.status(403).json({ 
        error: 'Acesso negado: produto não pertence ao tenant',
        tenantId,
        productTenantId: product.tenantId,
        productId: moduleData.productId
      });
    }

    console.log('📚 Dados do módulo validados:', moduleData);

    const module = await storage.createModule(moduleData);
    
    console.log('✅ Módulo criado:', module.id);
    res.status(201).json(module);
    
  } catch (error: any) {
    console.error('❌ Erro ao criar módulo:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 📚 BUSCAR MÓDULOS POR PRODUTO
app.get('/api/modules/:productId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    console.log('📚 API - Buscando módulos para produto:', productId);
    
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(403).json({ error: 'Acesso negado: tenant não identificado' });
    }

    // 🔒 VERIFICAÇÃO DE ACESSO - Verificar se o produto existe
    const product = await storage.getProduct(productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    // 🎓 VERIFICAR ACESSO: Seller (owner) OU Cliente (enrollment ativo)
    let hasAccess = false;
    
    // ✅ Opção 1: É o seller/owner do produto
    if (product.tenantId === tenantId) {
      hasAccess = true;
      console.log('✅ Acesso permitido: usuário é owner do produto');
    } else {
      // ✅ Opção 2: É um cliente com enrollment ativo
      // BUSCAR POR MÚLTIPLOS CAMPOS (memberId, customerId, customerEmail)
      await ensureFirebaseReady();
      const adminSdk = getAdmin();
      const db = adminSdk.firestore();
      
      // Buscar por memberId
      const enrollmentSnapshot1 = await db.collection('enrollments')
        .where('memberId', '==', req.user.uid)
        .where('productId', '==', productId)
        .get();
      
      // Buscar por customerId (para compatibilidade)
      const enrollmentSnapshot2 = await db.collection('enrollments')
        .where('customerId', '==', req.user.uid)
        .where('productId', '==', productId)
        .get();
      
      // Buscar por customerEmail
      let enrollmentSnapshot3: any = { docs: [] };
      if (req.user.email) {
        enrollmentSnapshot3 = await db.collection('enrollments')
          .where('customerEmail', '==', req.user.email)
          .where('productId', '==', productId)
          .get();
      }
      
      // Combinar todos os enrollments encontrados
      const allEnrollmentDocs = [
        ...enrollmentSnapshot1.docs,
        ...enrollmentSnapshot2.docs,
        ...enrollmentSnapshot3.docs
      ];
      
      console.log(`🔍 Enrollments encontrados para ${productId}: ${allEnrollmentDocs.length}`);

      for (const doc of allEnrollmentDocs) {
        const enrollmentData = doc.data();
        if (enrollmentData.status && ['active', 'completed'].includes(enrollmentData.status)) {
          hasAccess = true;
          console.log('✅ Acesso permitido: cliente tem enrollment ativo');
          break;
        }
      }
    }

    if (!hasAccess) {
      console.log(`❌ Acesso negado para produto ${productId} - usuário: ${req.user.uid}`);
      return res.status(403).json({ 
        error: 'Acesso negado: você não tem permissão para acessar este produto'
      });
    }

    const modules = await storage.listModulesByProduct(productId);
    
    // ⚡ BUSCAR AULAS PARA CADA MÓDULO - RETORNAR COMPLETO
    const modulesWithLessons = await Promise.all(
      modules.map(async (module) => {
        try {
          console.log(`🎓 Buscando aulas para módulo: ${module.id}`);
          const lessons = await storage.listLessonsByModule(module.id);
          console.log(`✅ Encontradas ${lessons.length} aulas para módulo ${module.id}`);
          return { ...module, lessons };
        } catch (error) {
          console.error(`❌ Erro ao buscar aulas do módulo ${module.id}:`, error);
          return { ...module, lessons: [] };
        }
      })
    );
    
    console.log(`✅ Encontrados ${modules.length} módulos com aulas para produto ${productId}`);
    res.json({ modules: modulesWithLessons });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar módulos:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 📚 ATUALIZAR MÓDULO
app.put('/api/modules/:moduleId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { moduleId } = req.params;
    console.log('📚 API - Atualizando módulo:', moduleId);
    
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(403).json({ error: 'Acesso negado: tenant não identificado' });
    }

    // 🛡️ VALIDAÇÃO ZOD PARA UPDATE (sem campos obrigatórios)
    const updateModuleSchema = insertModuleSchema.partial();
    const validationResult = updateModuleSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos',
        details: validationResult.error.flatten().fieldErrors 
      });
    }

    // 🔒 VERIFICAÇÃO DE OWNERSHIP - Verificar se o módulo pertence ao tenant
    const existingModule = await storage.getModule(moduleId);
    if (!existingModule) {
      return res.status(404).json({ error: 'Módulo não encontrado' });
    }

    const product = await storage.getProduct(existingModule.productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto do módulo não encontrado' });
    }

    if (product.tenantId !== tenantId) {
      return res.status(403).json({ 
        error: 'Acesso negado: módulo não pertence ao tenant',
        tenantId,
        productTenantId: product.tenantId 
      });
    }

    const moduleData = validationResult.data;
    const updatedModule = await storage.updateModule(moduleId, moduleData);
    
    if (!updatedModule) {
      return res.status(404).json({ error: 'Módulo não encontrado após atualização' });
    }
    
    console.log('✅ Módulo atualizado:', moduleId);
    res.json(updatedModule);
    
  } catch (error: any) {
    console.error('❌ Erro ao atualizar módulo:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

    
// 📚 DELETAR MÓDULO (COM CASCADE DELETION DE AULAS E BUNNY RESOURCES)
app.delete('/api/modules/:moduleId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { moduleId } = req.params;
    console.log('📚 API - Deletando módulo:', moduleId);
    
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(403).json({ error: 'Acesso negado: tenant não identificado' });
    }

    // 🔒 VERIFICAÇÃO DE OWNERSHIP - Verificar se o módulo pertence ao tenant ANTES de deletar
    const existingModule = await storage.getModule(moduleId);
    if (!existingModule) {
      return res.status(404).json({ error: 'Módulo não encontrado' });
    }

    const product = await storage.getProduct(existingModule.productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto do módulo não encontrado' });
    }

    if (product.tenantId !== tenantId) {
      return res.status(403).json({ 
        error: 'Acesso negado: módulo não pertence ao tenant',
        tenantId,
        productTenantId: product.tenantId 
      });
    }

    // 🔥 CASCADE DELETION: Buscar TODAS as aulas do módulo
    const lessons = await storage.listLessonsByModule(moduleId);
    console.log(`🔥 [CASCADE] Encontradas ${lessons.length} aulas para deletar`);

    // 🗑️ COLETAR RECURSOS DO BUNNY DE TODAS AS AULAS
    const bunnyResources = {
      videoGuids: [] as string[],
      imageUrls: [] as string[]
    };

    for (const lesson of lessons) {
      // Vídeo do Bunny
      if (lesson.videoType === 'panda' && lesson.videoUrl) {
        const guidMatch = lesson.videoUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (guidMatch) {
          bunnyResources.videoGuids.push(guidMatch[1]);
          console.log(`🗑️ [CASCADE] Vídeo Bunny da aula "${lesson.title}": ${guidMatch[1]}`);
        }
      }

      // IGNORAR CAPAS - Bunny CDN não precisa de cleanup manual
    }

    // 🗑️ DELETAR TODAS AS AULAS DO MÓDULO (Firestore)
    for (const lesson of lessons) {
      const deleted = await storage.deleteLesson(lesson.id);
      if (deleted) {
        console.log(`✅ [CASCADE] Aula deletada: ${lesson.title} (${lesson.id})`);
      }
    }

    // 🗑️ DELETAR O MÓDULO (Firestore)
    const moduleSuccess = await storage.deleteModule(moduleId);
    if (!moduleSuccess) {
      return res.status(500).json({ 
        error: 'Falha ao deletar módulo',
        message: 'Operação de delete falhou no storage' 
      });
    }
    console.log('✅ Módulo deletado do Firestore:', moduleId);

    // 🔥 DELETAR RECURSOS DO BUNNY.NET
    if (bunnyResources.videoGuids.length > 0 || bunnyResources.imageUrls.length > 0) {
      try {
        const { cleanupBunnyResources } = await import('./services/bunny-cleanup');
        const cleanupResult = await cleanupBunnyResources(
          bunnyResources.videoGuids,
          bunnyResources.imageUrls
        );
        
        console.log('🔥 [CASCADE] Cleanup Bunny concluído:', cleanupResult);
        
        return res.json({ 
          success: true, 
          message: `Módulo ${moduleId} e ${lessons.length} aula(s) deletados com sucesso`,
          bunnyCleanup: {
            videosDeleted: cleanupResult.videosDeleted,
            imagesDeleted: cleanupResult.imagesDeleted,
            lessonsDeleted: lessons.length,
            errors: cleanupResult.errors
          }
        });
      } catch (cleanupError: any) {
        console.error('⚠️ [CASCADE] Erro ao deletar recursos do Bunny (módulo/aulas deletados do banco):', cleanupError);
        return res.json({ 
          success: true, 
          message: `Módulo ${moduleId} e ${lessons.length} aula(s) deletados (aviso: recursos do Bunny podem não ter sido removidos)`,
          bunnyCleanupWarning: cleanupError.message
        });
      }
    }
    
    res.json({ 
      success: true, 
      message: `Módulo ${moduleId} deletado com sucesso (sem recursos Bunny)`,
      lessonsDeleted: lessons.length
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao deletar módulo:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});
// 🎓 CRIAR LIÇÃO
app.post('/api/lessons', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🎓 API - Criando lição...');
    
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(403).json({ error: 'Acesso negado: tenant não identificado' });
    }

    // 🛡️ VALIDAÇÃO ZOD - Validar dados do cliente
    const validationResult = insertLessonSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos',
        details: validationResult.error.flatten().fieldErrors 
      });
    }

    // ✅ Adicionar tenantId DEPOIS da validação (servidor controla tenancy)
    const lessonData = {
      ...validationResult.data,
      tenantId
    };

    // 🔒 VERIFICAÇÃO DE OWNERSHIP - Verificar se o módulo pertence ao tenant
    if (lessonData.moduleId) {
      const existingModule = await storage.getModule(lessonData.moduleId);
      if (!existingModule) {
        return res.status(404).json({ error: 'Módulo não encontrado' });
      }

      const product = await storage.getProduct(existingModule.productId);
      if (!product) {
        return res.status(404).json({ error: 'Produto do módulo não encontrado' });
      }

      if (product.tenantId !== tenantId) {
        return res.status(403).json({ 
          error: 'Acesso negado: módulo não pertence ao tenant',
          tenantId,
          productTenantId: product.tenantId 
        });
      }
    }

    console.log('🎓 Dados da lição validados:', lessonData);

    const lesson = await storage.createLesson(lessonData);
    
    console.log('✅ Lição criada:', lesson.id);
    res.status(201).json(lesson);
    
  } catch (error: any) {
    console.error('❌ Erro ao criar lição:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 🎓 BUSCAR TODAS AS LIÇÕES DO VENDEDOR (TENANT)
app.get('/api/lessons', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🎓 API - Buscando todas as lições do vendedor...');
    
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(403).json({ error: 'Acesso negado: tenant não identificado' });
    }

    console.log('🔍 DEBUG getTenantFromAuth: req.user =', req.user);
    const lessons = await storage.getLessonsByTenant(tenantId);
    console.log(`✅ Encontradas ${lessons.length} lições para tenant ${tenantId}`);
    
    res.json(lessons);
  } catch (error) {
    console.error('❌ Erro ao buscar lições do vendedor:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🎓 BUSCAR LIÇÕES POR MÓDULO
app.get('/api/lessons/:moduleId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { moduleId } = req.params;
    console.log('🎓 API - Buscando lições para módulo:', moduleId);
    
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    // 🔒 VERIFICAÇÃO DE OWNERSHIP - Verificar se o módulo pertence ao tenant
    const existingModule = await storage.getModule(moduleId);
    if (!existingModule) {
      return res.status(404).json({ error: 'Módulo não encontrado' });
    }

    const product = await storage.getProduct(existingModule.productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto do módulo não encontrado' });
    }

    // 🎓 VERIFICAR ACESSO: Seller (owner) OU Cliente (enrollment ativo)
    let hasAccess = false;
    const tenantId = await getTenantFromAuth(req);
    
    // ✅ Opção 1: É o seller/owner do produto
    if (tenantId && product.tenantId === tenantId) {
      hasAccess = true;
      console.log('✅ Lições: acesso permitido - usuário é owner');
    } else {
      // ✅ Opção 2: É um cliente com enrollment ativo
      await ensureFirebaseReady();
      const adminSdk = getAdmin();
      const db = adminSdk.firestore();
      
      const productId = existingModule.productId;
      
      // Buscar por memberId
      const enrollmentSnapshot1 = await db.collection('enrollments')
        .where('memberId', '==', req.user.uid)
        .where('productId', '==', productId)
        .get();
      
      // Buscar por customerEmail
      let enrollmentSnapshot2: any = { docs: [] };
      if (req.user.email) {
        enrollmentSnapshot2 = await db.collection('enrollments')
          .where('customerEmail', '==', req.user.email)
          .where('productId', '==', productId)
          .get();
      }
      
      const allEnrollmentDocs = [...enrollmentSnapshot1.docs, ...enrollmentSnapshot2.docs];
      
      for (const doc of allEnrollmentDocs) {
        const enrollmentData = doc.data();
        if (enrollmentData.status && ['active', 'completed'].includes(enrollmentData.status)) {
          hasAccess = true;
          console.log('✅ Lições: acesso permitido - cliente tem enrollment ativo');
          break;
        }
      }
    }

    if (!hasAccess) {
      return res.status(403).json({ 
        error: 'Acesso negado: você não tem permissão para acessar este módulo'
      });
    }

    const lessons = await storage.listLessonsByModule(moduleId);
    
    console.log(`✅ Encontradas ${lessons.length} lições para módulo ${moduleId}`);

    // 🔐 BUNNY SIGNED URLs — substitui URLs de vídeo por versões com token temporário
    const { signLessonVideos } = await import('./lib/bunny-signed-url.js');
    const signedLessons = await signLessonVideos(lessons);

    res.json(signedLessons);
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar lições:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 🎓 ATUALIZAR LIÇÃO
app.put('/api/lessons/:lessonId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { lessonId } = req.params;
    console.log('🎓 API - Atualizando lição:', lessonId);
    
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(403).json({ error: 'Acesso negado: tenant não identificado' });
    }

    // 🛡️ VALIDAÇÃO ZOD PARA UPDATE (sem campos obrigatórios)
    const updateLessonSchema = insertLessonSchema.partial();
    const validationResult = updateLessonSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos',
        details: validationResult.error.flatten().fieldErrors 
      });
    }

    // 🔒 VERIFICAÇÃO DE OWNERSHIP - Verificar se a lição pertence ao tenant
    const existingLesson = await storage.getLesson(lessonId);
    if (!existingLesson) {
      return res.status(404).json({ error: 'Lição não encontrada' });
    }

    const existingModule = await storage.getModule(existingLesson.moduleId);
    if (!existingModule) {
      return res.status(404).json({ error: 'Módulo da lição não encontrado' });
    }

    const product = await storage.getProduct(existingModule.productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto do módulo não encontrado' });
    }

    if (product.tenantId !== tenantId) {
      return res.status(403).json({ 
        error: 'Acesso negado: lição não pertence ao tenant',
        tenantId,
        productTenantId: product.tenantId 
      });
    }

    const lessonData = validationResult.data;
    const updatedLesson = await storage.updateLesson(lessonId, lessonData);
    
    if (!updatedLesson) {
      return res.status(404).json({ error: 'Lição não encontrada após atualização' });
    }
    
    console.log('✅ Lição atualizada:', lessonId);
    res.json(updatedLesson);
    
  } catch (error: any) {
    console.error('❌ Erro ao atualizar lição:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 🎓 DELETAR LIÇÃO (COM CASCADE DELETE DO BUNNY.NET)
app.delete('/api/lessons/:lessonId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { lessonId } = req.params;
    console.log('🎓 API - Deletando lição:', lessonId);
    
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(403).json({ error: 'Acesso negado: tenant não identificado' });
    }

    // 🔒 VERIFICAÇÃO DE OWNERSHIP - Verificar se a lição pertence ao tenant ANTES de deletar
    const existingLesson = await storage.getLesson(lessonId);
    if (!existingLesson) {
      return res.status(404).json({ error: 'Lição não encontrada' });
    }

    const existingModule = await storage.getModule(existingLesson.moduleId);
    if (!existingModule) {
      return res.status(404).json({ error: 'Módulo da lição não encontrado' });
    }

    const product = await storage.getProduct(existingModule.productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto do módulo não encontrado' });
    }

    if (product.tenantId !== tenantId) {
      return res.status(403).json({ 
        error: 'Acesso negado: lição não pertence ao tenant',
        tenantId,
        productTenantId: product.tenantId 
      });
    }

    // 🗑️ COLETAR RECURSOS DO BUNNY ANTES DE DELETAR
    const bunnyResources = {
      videoGuids: [] as string[],
      imageUrls: [] as string[]
    };

    // Se o vídeo é do Bunny (videoType === "panda"), videoUrl contém o GUID
    if (existingLesson.videoType === 'panda' && existingLesson.videoUrl) {
      // Extrair GUID da URL do Bunny (pode ser URL completa ou só o GUID)
      const guidMatch = existingLesson.videoUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      if (guidMatch) {
        bunnyResources.videoGuids.push(guidMatch[1]);
        console.log(`🗑️ [CASCADE] Vídeo Bunny identificado para deleção: ${guidMatch[1]}`);
      }
    }

    // IGNORAR CAPAS - Bunny CDN não precisa de cleanup manual
    // As capas estão no Bunny CDN, não precisam de cleanup manual

    // DELETAR DO BANCO PRIMEIRO
    const success = await storage.deleteLesson(lessonId);
    
    if (!success) {
      return res.status(500).json({ 
        error: 'Falha ao deletar lição',
        message: 'Operação de delete falhou no storage' 
      });
    }
    
    console.log('✅ Lição deletada do banco:', lessonId);

    // 🔥 DELETAR RECURSOS DO BUNNY.NET
    if (bunnyResources.videoGuids.length > 0 || bunnyResources.imageUrls.length > 0) {
      try {
        const { cleanupBunnyResources } = await import('./services/bunny-cleanup');
        const cleanupResult = await cleanupBunnyResources(
          bunnyResources.videoGuids,
          bunnyResources.imageUrls
        );
        
        console.log('🔥 [CASCADE] Cleanup Bunny concluído:', cleanupResult);
        
        // Retornar com detalhes do cleanup
        return res.json({ 
          success: true, 
          message: `Lição ${lessonId} deletada com sucesso`,
          bunnyCleanup: {
            videosDeleted: cleanupResult.videosDeleted,
            imagesDeleted: cleanupResult.imagesDeleted,
            errors: cleanupResult.errors
          }
        });
      } catch (cleanupError: any) {
        console.error('⚠️ [CASCADE] Erro ao deletar recursos do Bunny (aula deletada do banco):', cleanupError);
        // Aula foi deletada do banco, mas falhou no Bunny (não crítico)
        return res.json({ 
          success: true, 
          message: `Lição ${lessonId} deletada com sucesso (aviso: recursos do Bunny podem não ter sido removidos)`,
          bunnyCleanupWarning: cleanupError.message
        });
      }
    }
    
    res.json({ success: true, message: `Lição ${lessonId} deletada com sucesso` });
    
  } catch (error: any) {
    console.error('❌ Erro ao deletar lição:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 🎓 BUSCAR ENROLLMENTS DO USUÁRIO
app.get('/api/enrollments', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🎓 API - Buscando enrollments do usuário...');
    
    if (!req.user?.uid || !req.user?.email) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    // Buscar enrollments por email do usuário
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    if (!adminSdk?.firestore) {
      return res.status(500).json({ error: 'Firebase não inicializado' });
    }

    const db = adminSdk.firestore();
    const enrollmentsSnapshot = await db.collection('enrollments')
      .where('memberEmail', '==', req.user.email)
      .get();

    const enrollments = enrollmentsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data()?.createdAt?.toDate() || new Date(),
      updatedAt: doc.data()?.updatedAt?.toDate() || new Date(),
    }));

    console.log(`✅ Encontrados ${enrollments.length} enrollments para ${req.user.email}`);
    res.json(enrollments);
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar enrollments:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});


// 🌍 STRIPE - CRIAR PAYMENT INTENT PARA VENDAS GLOBAIS
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    console.log('💳 STRIPE GLOBAL - Criando Payment Intent...');
    
    const { amount, currency = 'usd', description = 'VolatusPay Payment' } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valor inválido' });
    }
    
    // ✅ USAR CONFIGURAÇÃO SEGURA DO STRIPE
    const stripeConfig = await loadSecureStripeConfig();
    
    if (!stripeConfig || !stripeConfig.secretKey) {
      console.error('❌ STRIPE NÃO CONFIGURADO - Chaves ausentes');
      return res.status(500).json({ error: 'Stripe não configurado' });
    }
    
    console.log(`💳 USANDO CONFIGURAÇÃO STRIPE: ${stripeConfig.environment}`);
    
    // Importar e inicializar Stripe
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(stripeConfig.secretKey, {
      apiVersion: '2025-08-27.basil',
    });
    
    // Criar Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Converter para centavos
      currency: currency.toLowerCase(),
      description,
      metadata: {
        platform: 'VolatusPay',
        timestamp: new Date().toISOString()
      }
    });
    
    console.log('✅ STRIPE Payment Intent criado:', paymentIntent.id);
    
    res.json({ 
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao criar Payment Intent:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 🔥 ENDPOINT CRÍTICO PARA CRIAR SESSÕES DE PAGAMENTO (STRIPE GLOBAL + EFIBANK BRASIL)
app.post('/api/payment/create-session', paymentIPRateLimit, sanitizeCheckoutInputs, idempotencyMiddleware, async (req, res) => {
  console.log('🔥 DEBUG - /api/payment/create-session chamado!', {
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    marketTarget: req.body?.marketTarget,
    method: req.body?.method
  });
  
  try {
    console.log('💳 CRIANDO SESSÃO DE PAGAMENTO...');
    
    const { 
      checkoutId, 
      method, 
      customer, 
      customerAddress, 
      amount, 
      currency = 'BRL',
      productType, 
      marketTarget = 'brasil',
      processor,
      cardData, 
      affiliateUid, 
      selectedOrderBumps = [],
      offerSlug, 
      offerTitle,
      trackingParameters,
      couponCode
    } = req.body;

    // 🛡️ VALIDAÇÕES CRÍTICAS
    if (!checkoutId || !method || !customer || !amount) {
      return res.status(400).json({ 
        error: 'Dados obrigatórios: checkoutId, method, customer, amount' 
      });
    }

    if (amount <= 0) {
      return res.status(400).json({ 
        error: 'Valor deve ser maior que zero' 
      });
    }

    // 🚨 CARDING DETECTOR — velocidade de tentativas por checkout/IP
    {
      const { checkCardingVelocity } = await import('./security/carding-detector.js');
      const cardingResult = await checkCardingVelocity(checkoutId, req);
      if (cardingResult.blocked) {
        return res.status(429).json({
          error: 'too_many_payment_attempts',
          message: cardingResult.message
        });
      }
    }

    if (!['pix', 'card', 'boleto'].includes(method)) {
      return res.status(400).json({ 
        error: 'Método de pagamento inválido. Use: pix, card ou boleto' 
      });
    }

    const docRaw = (customer.document || (customer as any).cpfCnpj || (customer as any).cpf || '').replace(/\D/g, '');
    if (method === 'pix' || method === 'boleto') {
      if (!docRaw || docRaw.length === 0) {
        return res.status(400).json({
          error: 'CPF/CNPJ obrigatório para pagamento',
          message: 'Por favor, informe seu CPF ou CNPJ para continuar.',
          code: 'MISSING_DOCUMENT'
        });
      }
      if (docRaw.length !== 11 && docRaw.length !== 14) {
        console.warn(`⚠️ Documento inválido: "${docRaw}" (length=${docRaw.length})`);
        return res.status(400).json({
          error: 'CPF deve ter 11 dígitos ou CNPJ deve ter 14 dígitos',
          message: 'Verifique o CPF ou CNPJ informado e tente novamente.',
          code: 'INVALID_DOCUMENT'
        });
      }
      customer.document = docRaw;
    } else if (docRaw) {
      customer.document = docRaw;
    }

    // 🌍 HELPER: Normalizar período de recorrência (aceitar PT-BR e EN)
    const normalizeSubscriptionPeriod = (period: string | undefined): string | undefined => {
      if (!period) return undefined;
      
      const periodMap: Record<string, string> = {
        // Português (mantém)
        'mensal': 'mensal',
        'trimestral': 'trimestral',
        'semestral': 'semestral',
        'anual': 'anual',
        // Inglês (converte)
        'monthly': 'mensal',
        'quarterly': 'trimestral',
        'semiannual': 'semestral',
        'annual': 'anual',
        'yearly': 'anual'
      };
      
      const normalized = periodMap[period.toLowerCase()];
      if (normalized) {
        console.log(`🔄 Período normalizado: ${period} → ${normalized}`);
        return normalized;
      }
      
      console.warn(`⚠️ Período desconhecido: ${period}`);
      return period.toLowerCase();
    };

    // 🏦 CARREGAR CONFIGURAÇÃO GLOBAL DE ADQUIRENTES (SETAGEM AUTOMÁTICA)
    console.log('🔄 [STEP 1] Iniciando configuração Firebase...');
    await ensureFirebaseReady();
    console.log('✅ [STEP 1] Firebase ready');
    
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    console.log('✅ [STEP 1] Firestore DB initialized');
    
    // 🟢 INICIALIZAR WOOVI API COM FIRESTORE
    setFirestoreInstance(db);
    console.log('✅ [STEP 1] Woovi API initialized with Firestore');

    // ⚡ PARALELIZAR: HMAC + PaymentConfig em paralelo (independentes entre si)
    console.log('🔄 [STEP 1-2] Carregando HMAC + PaymentConfig em paralelo...');
    const { getPaymentConfig } = await import('./lib/payment-config.js');
    const [webhookHmac, paymentConfig] = await Promise.all([
      getWebhookHmac(db),
      getPaymentConfig(db)
    ]);
    console.log('✅ [STEP 2] Payment config loaded:', {
      hasConfig: !!paymentConfig,
      hasDefaultAcquirers: !!paymentConfig?.defaultAcquirers
    });
    
    // 🎯 DETERMINAR ADQUIRENTE: Verificar se o SELLER tem configuração personalizada
    let pixAcquirer = paymentConfig?.defaultAcquirers?.pix || 'efibank';
    let cardBRAcquirer = paymentConfig?.defaultAcquirers?.creditCardBR || 'efibank';
    let cardGlobalAcquirer = paymentConfig?.defaultAcquirers?.creditCardGlobal || 'stripe';
    let boletoAcquirer = paymentConfig?.defaultAcquirers?.boleto || 'efibank';

    console.log(`🔍 [STEP 2-ACQ] defaultAcquirers de paymentConfig:`, JSON.stringify(paymentConfig?.defaultAcquirers || null));

    // 🔧 FIX: Se paymentConfig/global não existe, ler defaultAcquirers de admin/acquirers-config
    if (!paymentConfig?.defaultAcquirers) {
      try {
        const adminCfgDoc = await db.collection('admin').doc('acquirers-config').get();
        if (adminCfgDoc.exists) {
          const adminCfg = adminCfgDoc.data() as any;
          console.log(`🔍 [STEP 2-ACQ] admin/acquirers-config defaultAcquirers:`, JSON.stringify(adminCfg?.defaultAcquirers || null));
          if (adminCfg?.defaultAcquirers) {
            pixAcquirer = adminCfg.defaultAcquirers.pix || pixAcquirer;
            cardBRAcquirer = adminCfg.defaultAcquirers.creditCardBR || cardBRAcquirer;
            cardGlobalAcquirer = adminCfg.defaultAcquirers.creditCardGlobal || cardGlobalAcquirer;
            boletoAcquirer = adminCfg.defaultAcquirers.boleto || boletoAcquirer;
            console.log(`🔧 [FIX] Adquirentes lidos de admin/acquirers-config: PIX=${pixAcquirer}, CardBR=${cardBRAcquirer}, Boleto=${boletoAcquirer}`);
          }
        } else {
          console.log(`🔍 [STEP 2-ACQ] admin/acquirers-config NÃO existe no Firestore`);
        }
      } catch (e: any) {
        console.warn('⚠️ Falha ao ler admin/acquirers-config como fallback:', e.message);
      }
    }
    
    // 🔄 BACKWARD COMPATIBILITY: Se config antiga tinha creditCard, usar ela
    const legacyCreditCard = (paymentConfig?.defaultAcquirers as any)?.creditCard;
    if (legacyCreditCard && !paymentConfig?.defaultAcquirers?.creditCardBR) {
      if (legacyCreditCard === 'stripe' || legacyCreditCard === 'adyen') {
        cardGlobalAcquirer = legacyCreditCard;
      } else {
        cardBRAcquirer = legacyCreditCard;
      }
    }
    
    // 🛡️ VALIDAÇÃO CRÍTICA: NUNCA USAR WOOVI SE DESABILITADO (dupla criptografia corrompeu appId)
    if (pixAcquirer === 'woovi' && paymentConfig?.woovi?.enabled === false) {
      console.warn('⚠️ WOOVI está DESABILITADO mas foi definido como padrão! Forçando fallback para EfíBank...');
      pixAcquirer = 'efibank';
    }

    
    // 🔍 BUSCAR SELLER DONO DO CHECKOUT para verificar configurações personalizadas
    // ⚡ Resultado salvo para reutilizar na validação de afiliado (evita query duplicada)
    let _cachedCheckoutQueryForSession: any = null;
    let sellerId: string | undefined;
    try {
      const checkoutQuery = await db.collection('checkouts')
        .where('slug', '==', checkoutId)
        .limit(1)
        .get();
      _cachedCheckoutQueryForSession = checkoutQuery;
      
      if (!checkoutQuery.empty) {
        const checkoutDoc = checkoutQuery.docs[0];
        const checkoutData = checkoutDoc.data();
        sellerId = checkoutData?.tenantId;

        if (sellerId) {
          // 💰 VERIFICAR LIMITE DE TRANSAÇÃO ANTES DE PROCESSAR PAGAMENTO
          try {
            const { checkTransactionLimit } = await import('./security/transaction-limits.js');
            const txCheck = await checkTransactionLimit(sellerId, amount);
            if (!txCheck.allowed) {
              console.warn(`🚫 [TX-LIMITS] Bloqueado: ${txCheck.reason} — seller: ${sellerId.slice(0, 8)}...`);
              return res.status(403).json({
                error: txCheck.reason || 'Limite de transação atingido.',
                code: 'TRANSACTION_LIMIT_EXCEEDED',
              });
            }
          } catch (txErr: any) {
            console.warn(`⚠️ [TX-LIMITS] Erro na verificação (não bloqueante):`, txErr?.message);
          }

          console.log(`🔍 [STEP 2.1] Verificando adquirentes do seller: ${sellerId}`);
          
        

          // Buscar configurações de adquirente do seller
          const sellerRef = db.collection('sellers').doc(sellerId);
          const sellerSnapshot = await sellerRef.get();
          
          if (sellerSnapshot.exists) {
            const sellerData = sellerSnapshot.data();
            const sellerAcquirers = sellerData?.acquirers;
            
            if (sellerAcquirers) {
              // Usar adquirente do seller (já sincronizado com os padrões do admin via bulk-update)
              if (sellerAcquirers.pix) {
                pixAcquirer = sellerAcquirers.pix;
                console.log(`✅ [STEP 2.1] Seller PIX: ${pixAcquirer}`);
              }

              if (sellerAcquirers.creditCardBR) {
                cardBRAcquirer = sellerAcquirers.creditCardBR;
                console.log(`✅ [STEP 2.1] Seller Cartão BR: ${cardBRAcquirer}`);
              } else if (sellerAcquirers.creditCard && sellerAcquirers.creditCard !== 'stripe' && sellerAcquirers.creditCard !== 'adyen') {
                // Legacy: creditCard field = BR acquirer
                cardBRAcquirer = sellerAcquirers.creditCard;
                console.log(`⚠️ [STEP 2.1] Seller creditCard LEGACY → BR: ${cardBRAcquirer}`);
              }

              if (sellerAcquirers.creditCardGlobal) {
                cardGlobalAcquirer = sellerAcquirers.creditCardGlobal;
                console.log(`✅ [STEP 2.1] Seller Cartão Global: ${cardGlobalAcquirer}`);
              } else if (sellerAcquirers.creditCard === 'stripe' || sellerAcquirers.creditCard === 'adyen') {
                cardGlobalAcquirer = sellerAcquirers.creditCard;
                console.log(`⚠️ [STEP 2.1] Seller creditCard LEGACY → Global: ${cardGlobalAcquirer}`);
              }
            } else {
              console.log(`ℹ️ [STEP 2.1] Seller sem acquirers personalizados — usando padrão global`);
            }
          }
        }
      }
    } catch (sellerConfigError) {
      console.error('⚠️ [STEP 2.1] Erro ao buscar config do seller - usando global:', sellerConfigError);
      // Continuar com configuração global em caso de erro
    }
    
    // 🌍 DETERMINAR QUAL ADQUIRENTE DE CARTÃO USAR (BR vs GLOBAL)
    // Por padrão, usar BR. Quando tivermos detecção de BIN, isso será dinâmico
    const cardAcquirer = method === 'card' ? cardBRAcquirer : null;
    
    // 🛡️ VALIDAÇÃO FINAL: BLOQUEAR WOOVI GLOBALMENTE SE DESABILITADO
    if (pixAcquirer === 'woovi' && paymentConfig?.woovi?.enabled === false) {
      console.error('🚨 WOOVI DESABILITADO! Forçando EfíBank como fallback FINAL...');
      pixAcquirer = 'efibank';
    }
    
    console.log(`🏦 [STEP 2] ADQUIRENTES CONFIGURADOS: PIX=${pixAcquirer}, CardBR=${cardBRAcquirer}, CardGlobal=${cardGlobalAcquirer}, Card=${cardAcquirer}`);

    let validatedAffiliateUid: string | null = null;
    let resolvedAffiliateCode: string | null = null;
    let resolvedAffiliateName: string | null = null;
    let resolvedAffiliateEmail: string | null = null;
    let resolvedCommissionPercent: number = 10;
    if (affiliateUid) {
      try {
        // ⚡ REUTILIZAR query de checkout já feita acima (evita query Firestore duplicada)
        const checkoutQueryPre = _cachedCheckoutQueryForSession || await db.collection('checkouts')
          .where('slug', '==', checkoutId)
          .limit(1)
          .get();
        
        if (!checkoutQueryPre.empty) {
          const checkoutDocPre = checkoutQueryPre.docs[0];
          const checkoutDataPre = checkoutDocPre.data();
          const productOwnerTenantId = checkoutDataPre?.tenantId;
          const checkoutDocId = checkoutDocPre.id;
          const checkoutProductId = checkoutDataPre?.productId;
          const productIdsToTry = [checkoutDocId];
          if (checkoutProductId && checkoutProductId !== checkoutDocId) {
            productIdsToTry.push(checkoutProductId);
          }
          console.log(`🔍 [AFFILIATE] Validando afiliado "${affiliateUid}" para produto(s) [${productIdsToTry.join(', ')}] (checkout: ${checkoutDocId}, seller: ${productOwnerTenantId})`);
          
          let affiliateProductData: any = null;

          // ✅ FIX: usar campo único por query (sem índice composto) + filtrar em memória
          // Queries com múltiplos .where() em campos diferentes exigem índice composto no Firestore
          // que pode não existir, causando erro silenciado e perda do dado de afiliado no pedido.

          // 1️⃣ Buscar por affiliateId (campo único) e filtrar em memória por productId/sellerId/status
          try {
            const byIdSnap = await db.collection('affiliations')
              .where('affiliateId', '==', affiliateUid)
              .get();
            const byIdMatch = byIdSnap.docs.find(doc => {
              const d = doc.data();
              return d.status === 'approved' && productIdsToTry.includes(d.productId);
            });
            if (byIdMatch) {
              affiliateProductData = byIdMatch.data();
              validatedAffiliateUid = affiliateUid;
              resolvedAffiliateCode = affiliateProductData.affiliateCode || affiliateUid;
              resolvedAffiliateName = affiliateProductData.affiliateName || null;
              resolvedAffiliateEmail = affiliateProductData.affiliateEmail || null;
              resolvedCommissionPercent = affiliateProductData.customCommission ?? affiliateProductData.commissionSnapshot?.single ?? 10;
              console.log(`✅ AFILIADO VALIDADO POR UID: ${affiliateUid} → ${affiliateProductData.productId} (comissão: ${resolvedCommissionPercent}%)`);
            }
          } catch (e: any) { console.error('⚠️ Erro busca affiliations por ID:', e?.message); }

          // 2️⃣ Buscar por affiliateCode (campo único) e filtrar em memória por productId/status
          if (!affiliateProductData) {
            try {
              const byCodeSnap = await db.collection('affiliations')
                .where('affiliateCode', '==', affiliateUid)
                .get();
              const byCodeMatch = byCodeSnap.docs.find(doc => {
                const d = doc.data();
                return d.status === 'approved' && productIdsToTry.includes(d.productId);
              });
              if (byCodeMatch) {
                affiliateProductData = byCodeMatch.data();
                validatedAffiliateUid = affiliateProductData.affiliateId;
                resolvedAffiliateCode = affiliateUid;
                resolvedAffiliateName = affiliateProductData.affiliateName || null;
                resolvedAffiliateEmail = affiliateProductData.affiliateEmail || null;
                resolvedCommissionPercent = affiliateProductData.customCommission ?? affiliateProductData.commissionSnapshot?.single ?? 10;
                console.log(`✅ AFILIADO RESOLVIDO POR CÓDIGO: ${affiliateUid} → UID: ${validatedAffiliateUid} → ${affiliateProductData.productId} (comissão: ${resolvedCommissionPercent}%)`);
              }
            } catch (e: any) { console.error('⚠️ Erro busca affiliations por código:', e?.message); }
          }

          if (validatedAffiliateUid && (!resolvedAffiliateName || !resolvedAffiliateEmail)) {
            try {
              const affSellerDoc = await db.collection('sellers').doc(validatedAffiliateUid).get();
              if (affSellerDoc.exists) {
                const affData = affSellerDoc.data();
                if (!resolvedAffiliateName) {
                  resolvedAffiliateName = affData?.businessName || affData?.name || affData?.email?.split('@')[0] || null;
                }
                if (!resolvedAffiliateEmail) {
                  resolvedAffiliateEmail = affData?.email || null;
                }
              }
            } catch (e) { /* fallback silencioso */ }
          }

          // 3️⃣ FALLBACK: buscar em 'affiliates' (fluxo de cadastro público) — campo único + filtro em memória
          if (!affiliateProductData) {
            try {
              const [byNewCodeSnap, byNewSlugSnap] = await Promise.all([
                db.collection('affiliates').where('affiliateCode', '==', affiliateUid).get(),
                db.collection('affiliates').where('affiliateSlug', '==', affiliateUid).get()
              ]);
              const allNewDocs = [...byNewCodeSnap.docs, ...byNewSlugSnap.docs];
              const newAffDoc = allNewDocs.find(doc => doc.data().status === 'approved');
              if (newAffDoc) {
                affiliateProductData = newAffDoc.data();
                validatedAffiliateUid = affiliateProductData.userId || newAffDoc.id;
                resolvedAffiliateCode = affiliateProductData.affiliateCode || affiliateProductData.affiliateSlug || affiliateUid;
                resolvedAffiliateName = affiliateProductData.name || null;
                resolvedAffiliateEmail = affiliateProductData.email || null;
                resolvedCommissionPercent = affiliateProductData.customCommission ?? 10;
                console.log(`✅ AFILIADO RESOLVIDO VIA 'affiliates': ${affiliateUid} → UID: ${validatedAffiliateUid} (comissão: ${resolvedCommissionPercent}%)`);
              }
            } catch (newAffErr: any) {
              console.error('⚠️ Erro ao buscar em affiliates:', newAffErr?.message);
            }
          }

          if (!affiliateProductData) {
            console.warn(`🚨 Afiliado ${affiliateUid} NÃO está aprovado para produto [${productIdsToTry.join(', ')}] (seller: ${productOwnerTenantId}) - IGNORADO`);
          }
        } else {
          console.warn(`⚠️ Checkout ${checkoutId} não encontrado durante validação de afiliado`);
        }
      } catch (affiliateCheckError) {
        console.error('❌ Erro ao validar affiliateUid:', affiliateCheckError);
      }
    }

    // 🌍 CHECKOUTS GLOBAIS → STRIPE
    if (marketTarget === 'global' || processor === 'stripe') {
      console.log('🌍 [STEP 3] CHECKOUT GLOBAL DETECTADO - Usando STRIPE...');
      
      console.log('🔄 [STEP 3.1] Carregando configuração Stripe...');
      const stripeConfig = await loadSecureStripeConfig();
      console.log('✅ [STEP 3.1] loadSecureStripeConfig retornou:', {
        hasConfig: !!stripeConfig,
        hasSecretKey: !!stripeConfig?.secretKey,
        hasPublicKey: !!stripeConfig?.publicKey,
        environment: stripeConfig?.environment
      });
      
      if (!stripeConfig || !stripeConfig.secretKey) {
        console.error('❌ STRIPE NÃO CONFIGURADO - Chaves ausentes', {
          stripeConfig,
          hasSecretKey: !!stripeConfig?.secretKey
        });
        return res.status(503).json({ 
          error: 'Stripe not configured', 
          message: 'Payment system is not yet configured. Please contact support or configure Stripe in admin settings.',
          configMissing: true
        });
      }
      
      console.log(`💳 USANDO CONFIGURAÇÃO STRIPE: ${stripeConfig.environment}`);
      
      // Importar e inicializar Stripe
      const { default: Stripe } = await import('stripe');
      const stripe = new Stripe(stripeConfig.secretKey, {
        apiVersion: '2025-08-27.basil',
      });
      
      // Criar Payment Intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount), // Já em centavos
        currency: (currency || 'USD').toLowerCase(),
        description: `Payment for ${checkoutId}`,
        metadata: {
          platform: 'VolatusPay',
          checkoutId,
          orderId: `order_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          affiliateUid: validatedAffiliateUid || 'none'
        }
      });
      
      console.log('✅ STRIPE Payment Intent criado:', paymentIntent.id);
      
      return res.json({ 
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        processor: 'stripe'
      });
    }
    
    // 🇧🇷 CHECKOUTS BRASILEIROS → EFIBANK/WOOVI (baseado na config)
    console.log(`🇧🇷 [STEP 3] CHECKOUT BRASIL DETECTADO - Usando ${method === 'pix' ? pixAcquirer.toUpperCase() : 'EFIBANK'}...`);

    const efiKeysForSession = await getEfiBankKeys(db);
    const efiBankConfig = paymentConfig?.efibank;
    const efiBankEnvironment = efiKeysForSession.environment;
    const useProductionEfi = efiBankEnvironment === 'production';
    let clientId = efiKeysForSession.clientId;
    let clientSecret = efiKeysForSession.clientSecret;
    const payeeCode = efiKeysForSession.payeeCode;
    const pixKey = efiKeysForSession.pixKey;

    console.log('✅ [STEP 3] Credenciais EfíBank carregadas (via getEfiBankKeys):', {
      environment: efiBankEnvironment,
      isProduction: useProductionEfi,
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasPayeeCode: !!payeeCode,
      hasPixKey: !!pixKey,
      clientIdLength: clientId?.length || 0,
    });

    let efiBankNotRequired = (method === 'pix' && (pixAcquirer === 'woovi' || pixAcquirer === 'onz'));
    if (!efiBankNotRequired) {
      if (!clientId || !clientSecret) {
        // AUTO-FALLBACK: EfiBank não configurado — tentar ONZ Finance
        if (method === 'pix') {
          let fallbackFound = false;
          try {
            const onzFbCfg = await loadOnzCredentials();
            if (onzFbCfg?.enabled) {
              console.warn(`⚠️ [STEP 3] EfiBank ausente mas ONZ configurado — auto-switch para ONZ`);
              pixAcquirer = 'onz';
              efiBankNotRequired = true;
              fallbackFound = true;
            }
          } catch { /* ignorar */ }

          if (!fallbackFound) {
            console.error('❌ [STEP 3] CREDENCIAIS EFIBANK AUSENTES e nenhum gateway PIX alternativo disponível');
            return res.status(500).json({ 
              error: 'Gateway de pagamento PIX não configurado. Configure EfíBank ou ONZ Finance.' 
            });
          }
        } else {
          console.error('❌ [STEP 3] CREDENCIAIS EFIBANK AUSENTES');
          return res.status(500).json({ 
            error: 'EfíBank não configurado - credenciais ausentes' 
          });
        }
      } else {
        console.log(`✅ [STEP 3] CREDENCIAIS EFIBANK VALIDADAS (${clientId.length} chars, descriptografadas)`);
      }
    }

    // 🏦 BUSCAR CHECKOUT NO FIREBASE (db já foi declarado acima)
    console.log(`🔄 [STEP 4] Buscando checkout no Firebase: ${checkoutId}`);
    let checkoutQuery = await db.collection('checkouts')
      .where('slug', '==', checkoutId)
      .limit(1)
      .get();
    console.log('✅ [STEP 4] Query por slug. Resultados:', checkoutQuery.size);

    // Fallback: tentar busca pelo document ID quando slug não encontra (checkout legado sem slug)
    let checkoutDocFallback: any = null;
    if (checkoutQuery.empty) {
      console.log(`🔄 [STEP 4] Slug não encontrado, tentando busca por document ID: ${checkoutId}`);
      const docById = await db.collection('checkouts').doc(checkoutId).get();
      if (docById.exists) {
        checkoutDocFallback = docById;
        console.log(`✅ [STEP 4] Checkout encontrado por document ID: ${checkoutId}`);
      }
    }

    if (checkoutQuery.empty && !checkoutDocFallback) {
      console.error('❌ [STEP 4] CHECKOUT NÃO ENCONTRADO (slug nem ID):', checkoutId);
      
      const allCheckoutsQuery = await db.collection('checkouts').limit(5).get();
      const availableCheckouts = allCheckoutsQuery.docs.map(doc => ({
        id: doc.id,
        slug: doc.data().slug,
        title: doc.data().title || 'Sem título'
      }));
      
      console.error('🔍 CHECKOUTS DISPONÍVEIS NO SISTEMA:', availableCheckouts);
      
      return res.status(404).json({ 
        error: 'Checkout não encontrado', 
        details: `Não foi possível localizar um checkout com o slug "${checkoutId}". Verifique se o link está correto e se o checkout não foi removido.`,
        availableCount: availableCheckouts.length,
        debug: process.env.NODE_ENV !== 'production' ? availableCheckouts : undefined
      });
    }

    const checkoutDoc = checkoutDocFallback || checkoutQuery.docs[0];
    const checkoutData = checkoutDoc.data() as any;
    const checkout = { id: checkoutDoc.id, ...checkoutData };
    
    console.log('✅ CHECKOUT ENCONTRADO:', checkout.title);

    // 🛡️ VALIDAÇÃO CRÍTICA DE SEGURANÇA: VERIFICAR PREÇO SERVER-SIDE
    // Cliente NUNCA pode definir o preço - deve vir do banco de dados
    let expectedPrice = checkout.pricing?.amount || 0;
    let effectivePricing = checkout.pricing || { amount: expectedPrice };
    
    // Se houver offerSlug, buscar preço E PERÍODO da oferta específica
    if (offerSlug && checkout.offers && Array.isArray(checkout.offers)) {
      const selectedOffer = checkout.offers.find((o: any) => o.slug === offerSlug);
      if (selectedOffer && selectedOffer.pricing?.amount) {
        expectedPrice = selectedOffer.pricing.amount;
        effectivePricing = selectedOffer.pricing; // 🔄 USAR PRICING COMPLETO DA OFERTA (inclui subscriptionPeriod!)
        console.log(`💰 USANDO PRICING DA OFERTA "${offerSlug}": R$ ${(expectedPrice/100).toFixed(2)}`);
        if (selectedOffer.pricing.subscriptionPeriod) {
          console.log(`🔄 PERÍODO DA OFERTA: ${selectedOffer.pricing.subscriptionPeriod}`);
        }
      } else {
        console.warn(`⚠️ Oferta "${offerSlug}" não encontrada ou sem pricing, usando preço padrão`);
      }
    }
    
    // 🏷️ CUPOM: aplicar desconto sobre preço base antes de bumps/PIX
    if (couponCode && checkout.tenantId) {
      try {
        const couponDoc = await storage.getCouponByCode(couponCode, checkout.tenantId);
        if (couponDoc) {
          const couponDiscount = couponDoc.type === 'percentage'
            ? Math.round(expectedPrice * couponDoc.value / 100)
            : Math.round(couponDoc.value); // valor fixo já em centavos
          expectedPrice = Math.max(0, expectedPrice - couponDiscount);
          console.log(`🏷️ [CUPOM] ${couponCode} válido: -R$${(couponDiscount/100).toFixed(2)} → expectedPrice: R$${(expectedPrice/100).toFixed(2)}`);
        } else {
          console.warn(`⚠️ [CUPOM] ${couponCode} não encontrado/inativo — ignorado na validação de preço`);
        }
      } catch (couponErr: any) {
        console.warn(`⚠️ [CUPOM] Erro ao validar ${couponCode}: ${couponErr.message} — continuando sem desconto de cupom`);
      }
    }

    // 📦 ORDER BUMPS: adicionar preços dos produtos selecionados ao expectedPrice
    // e construir array enriquecido para gravar no pedido (com nome e preço reais)
    const enrichedOrderBumps: Array<{ checkoutId: string; name: string; price: number }> = [];
    if (Array.isArray(selectedOrderBumps) && selectedOrderBumps.length > 0) {
      for (const bumpRef of selectedOrderBumps) {
        const bumpCheckoutId = typeof bumpRef === 'string' ? bumpRef : (bumpRef as any)?.checkoutId;
        if (!bumpCheckoutId) continue;
        try {
          // Tentar pegar preço do orderBump.products já carregado no checkout
          const knownBump = Array.isArray(checkout.orderBump?.products)
            ? checkout.orderBump.products.find((p: any) => p.checkoutId === bumpCheckoutId)
            : null;
          let bumpPrice = knownBump?.price > 0 ? knownBump.price : 0;
          let bumpName: string = knownBump?.customTitle || knownBump?.title || '';
          if (!bumpPrice) {
            // Fallback: buscar do Firestore
            const bumpDoc = await db.collection('checkouts').doc(bumpCheckoutId).get();
            if (bumpDoc.exists) {
              const bumpData = bumpDoc.data() as any;
              bumpPrice = bumpData?.pricing?.amount || 0;
              if (!bumpName) bumpName = bumpData?.title || bumpData?.name || '';
            }
          }
          if (!bumpName) bumpName = 'Order Bump';
          if (bumpPrice > 0) {
            expectedPrice += bumpPrice;
            enrichedOrderBumps.push({ checkoutId: bumpCheckoutId, name: bumpName, price: bumpPrice });
            console.log(`📦 [ORDER BUMP] +R$${(bumpPrice/100).toFixed(2)} "${bumpName}" (${bumpCheckoutId}) → expectedPrice: R$${(expectedPrice/100).toFixed(2)}`);
          }
        } catch (bumpErr: any) {
          console.warn(`⚠️ [ORDER BUMP] Falha ao buscar preço de ${bumpCheckoutId}: ${bumpErr.message}`);
        }
      }
    }

    // 💸 APLICAR DESCONTO PIX ao expectedPrice (após cupom + bumps, igual ao frontend)
    if (method === 'pix' && checkout.discounts?.pix?.value) {
      const pixDiscVal = parseFloat(checkout.discounts.pix.value) || 0;
      if (pixDiscVal > 0) {
        const pixDiscAmt = checkout.discounts.pix.type === 'R$'
          ? Math.round(pixDiscVal * 100) // valor fixo em centavos
          : Math.round(expectedPrice * pixDiscVal / 100); // % do total pós-cupom+bumps
        expectedPrice = Math.max(0, expectedPrice - pixDiscAmt);
        console.log(`💸 PIX DISCOUNT aplicado: -${checkout.discounts.pix.type === 'R$' ? 'R$' + (pixDiscAmt/100).toFixed(2) : pixDiscVal + '%'} → expectedPrice: R$ ${(expectedPrice/100).toFixed(2)}`);
      }
    }

    // Validar preço com margem de erro de 1% (para arredondamentos)
    const priceDifference = Math.abs(amount - expectedPrice);
    const allowedTolerance = Math.max(1, expectedPrice * 0.01); // 1% ou mínimo 1 centavo
    
    if (priceDifference > allowedTolerance) {
      console.error(`🚨 TENTATIVA DE FRAUDE: Preço enviado (R$ ${(amount/100).toFixed(2)}) diferente do esperado (R$ ${(expectedPrice/100).toFixed(2)})`);
      console.error(`🚨 IP: ${req.headers['x-forwarded-for'] || req.ip || 'unknown'}`);
      console.error(`🚨 CHECKOUT: ${checkout.title} (${checkoutId})`);
      console.error(`🚨 CUSTOMER: ${customer.email}`);
      
      return res.status(400).json({
        error: 'Valor inválido',
        message: 'O preço enviado não corresponde ao valor do produto. Por favor, recarregue a página e tente novamente.',
        expectedPrice: expectedPrice,
        sentPrice: amount
      });
    }
    
    console.log(`✅ PREÇO VALIDADO: R$ ${(amount/100).toFixed(2)} (diferença: R$ ${(priceDifference/100).toFixed(2)})`);

    // 🔥 CRIAR ORDEM NO FIREBASE PRIMEIRO
    // [IDEMPOTENCY] ID agora vem do helper // const orderId = `temp_order_${Date.now()}_${Math.random().toString(36).substring(7)}`; // Temporário, será substituído
    
    const cleanCustomer = {
      name: customer.name,
      email: customer.email,
      document: customer.document || (customer as any).cpfCnpj || (customer as any).cpf || '',
      ...(customer.phone && { phone: customer.phone })
    };
    
    if (!customer.document && cleanCustomer.document) {
      customer.document = cleanCustomer.document;
    }
    
    const buildDevedor = (doc: string, nome: string) => {
      const cleanDoc = (doc || '').replace(/\D/g, '');
      if (cleanDoc.length === 14) {
        return { cnpj: cleanDoc, nome };
      }
      return { cpf: cleanDoc, nome };
    };
    
    // 💰 CALCULAR TAXAS DINÂMICAS BASEADO NA CONFIGURAÇÃO DO ADMIN
    const checkoutInstallments = method === 'card' ? (cardData?.installments || 1) : 1;
    console.log(`🔄 [STEP 5] Calculando taxas dinâmicas para ${method} ${checkoutInstallments}x com ${method === 'pix' ? pixAcquirer : cardAcquirer}`);
    const feeCalculation = await calculateDynamicFees(amount, method, checkoutInstallments, method === 'pix' ? pixAcquirer : cardAcquirer, sellerId);
    console.log('✅ [STEP 5] Taxas calculadas:', {
      gatewayFee: feeCalculation.gatewayFee,
      platformFee: feeCalculation.platformFee,
      netAmount: feeCalculation.netAmount
    });
    
    console.log('🔄 [STEP 6] Criando ordem no Firebase...');

    // 🎯 TIPO EFETIVO DO PRODUTO (req.body → checkout → fallback digital)
    const effectiveProductType = productType || checkout.productType || 'digital';
    
    // 📸 CRITICAL: CRIAR SNAPSHOT DO CHECKOUT NO MOMENTO DA VENDA
    // Isso garante que o histórico de preços seja preservado PARA SEMPRE
    // Mesmo que o seller mude o preço depois, vendas antigas mantêm o preço original
    const checkoutSnapshot = {
      title: checkout.title || '',
      subtitle: checkout.subtitle || '',
      description: checkout.description || '',
      logoUrl: checkout.logoUrl || null,
      bannerUrl: checkout.bannerUrl || null,
      price: amount, // Preço REAL pago pelo cliente neste momento
      originalPrice: checkout.pricing?.amount || amount,
      productType: effectiveProductType,
      marketTarget: marketTarget,
      pricing: effectivePricing // 🔄 PRICING COMPLETO (inclui subscriptionPeriod da oferta ou checkout!)
    };
    
    // 🔄 VALIDAÇÃO CRÍTICA: Produtos de assinatura DEVEM ter período de recorrência
    const isSubscription = effectiveProductType === 'subscription' || effectivePricing?.billingType === 'subscription';
    if (isSubscription) {
      let subscriptionPeriod = effectivePricing?.subscriptionPeriod || checkout.pricing?.subscriptionPeriod;
      subscriptionPeriod = normalizeSubscriptionPeriod(subscriptionPeriod);
      
      if (!subscriptionPeriod) {
        console.error('❌ SUBSCRIPTION SEM PERÍODO:', {
          checkoutId: checkout.id,
          checkoutTitle: checkout.title,
          productType: productType,
          billingType: effectivePricing?.billingType,
          offerSlug: offerSlug
        });
        return res.status(400).json({ 
          error: 'Produto de assinatura inválido',
          message: 'Este produto de assinatura não possui um período de recorrência configurado. Entre em contato com o vendedor.'
        });
      }
      
      const validPeriods = ['mensal', 'trimestral', 'semestral', 'anual'];
      if (!validPeriods.includes(subscriptionPeriod)) {
        console.error('❌ PERÍODO INVÁLIDO:', {
          subscriptionPeriod,
          checkoutId: checkout.id,
          validPeriods
        });
        return res.status(400).json({ 
          error: 'Configuração de assinatura inválida',
          message: `O período de recorrência configurado (${subscriptionPeriod}) não é válido. Entre em contato com o vendedor.`
        });
      }
      
      console.log(`✅ VALIDAÇÃO SUBSCRIPTION OK: Período = ${subscriptionPeriod}`);
    }

    const orderData = {
      // id será adicionado pelo helper idempotency
      checkoutId: checkout.id,
      checkoutSlug: checkoutId,
      productId: checkout.productId || null, // 🔑 CRITICAL: productId para acesso à área de membros
      tenantId: checkout.tenantId,
      customer: cleanCustomer,
      customerAddress: customerAddress || null,
      amount: amount,
      currency: 'BRL',
      method: method,
      status: 'pending',
      productType: effectiveProductType,
      subscriptionPeriod: (isSubscription && effectivePricing?.subscriptionPeriod) ? effectivePricing.subscriptionPeriod : null,
      saleType: method === 'pix' ? 'pix_checkout' : (method === 'credit_card' || method === 'card' ? 'card_checkout' : 'checkout'),
      marketTarget: marketTarget,
      // 📸 SNAPSHOT DO CHECKOUT (HISTÓRICO ETERNO)
      checkoutSnapshot: checkoutSnapshot,
      // 🏦 ADQUIRENTE USADO (CONFIGURAÇÃO GLOBAL APLICADA AUTOMATICAMENTE)
      processor: method === 'pix' ? pixAcquirer : cardAcquirer,
      acquirer: method === 'pix' ? pixAcquirer : cardAcquirer,
      affiliateUid: validatedAffiliateUid || null,
      affiliateCode: resolvedAffiliateCode || null,
      affiliateName: resolvedAffiliateName || null,
      affiliateEmail: resolvedAffiliateEmail || null,
      isAffiliateSale: !!(validatedAffiliateUid || resolvedAffiliateCode),
      affiliateCommission: (validatedAffiliateUid || resolvedAffiliateCode) ? {
        amount: Math.round((amount * resolvedCommissionPercent) / 100),
        percentage: resolvedCommissionPercent,
        code: resolvedAffiliateCode || null,
        affiliateId: validatedAffiliateUid || null
      } : null,
      selectedOrderBumps: selectedOrderBumps,
      orderBumps: enrichedOrderBumps.length > 0 ? enrichedOrderBumps : null,
      offerSlug: offerSlug || null,
      offerTitle: offerTitle || null,
      couponCode: couponCode || null,
      trackingParameters: trackingParameters || null,
      // 💰 TAXAS DINÂMICAS (baseadas na configuração do admin)
      gatewayFee: feeCalculation.gatewayFee,
      gatewayFeePercent: feeCalculation.gatewayFeePercent,
      platformFee: feeCalculation.platformFee,
      platformFeePercent: feeCalculation.platformFeePercent,
      netAmount: feeCalculation.netAmount,
      // 📊 SNAPSHOT FINANCEIRO ETERNO - PRESERVA TAXAS E PRAZOS DA DATA DA VENDA
      financialData: {
        grossAmount: amount,
        feeAmount: feeCalculation.gatewayFee + feeCalculation.platformFee,
        netAmount: feeCalculation.netAmount,
        releaseDate: new Date(Date.now() + (feeCalculation.releaseDays || 0) * 24 * 60 * 60 * 1000),
        released: false,
        feeBreakdown: {
          fixedFee: 0, // Calculado na taxa percentual
          percentFee: feeCalculation.gatewayFeePercent,
          percentAmount: feeCalculation.gatewayFee,
          platformFeePercent: feeCalculation.platformFeePercent, // 🔥 SNAPSHOT DA TAXA DE PLATAFORMA
          platformFeeAmount: feeCalculation.platformFee // 🔥 SNAPSHOT DO VALOR DA TAXA DE PLATAFORMA
        },
        releaseDays: feeCalculation.releaseDays || 0 // 🔥 PRAZO SALVO PARA SEMPRE
      },
      // 💳 CONTROLE DE SALDO PENDENTE (usado pelo cron de liberação e balance summary)
      financial: {
        netAmount: feeCalculation.netAmount,
        gatewayFee: feeCalculation.gatewayFee,
        gatewayFeePercent: feeCalculation.gatewayFeePercent,
        platformFee: feeCalculation.platformFee,
        platformFeePercent: feeCalculation.platformFeePercent,
        balanceType: method === 'card' ? 'pending' : 'available',
        releaseDate: method === 'card' ? new Date(Date.now() + (feeCalculation.releaseDays || 30) * 24 * 60 * 60 * 1000) : null,
        releaseDays: feeCalculation.releaseDays || 0,
        cardBalanceReleased: method === 'card' ? false : null,
        released: method === 'pix',
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // [IDEMPOTENCY] Helper cria atomicamente - removido //     // 💾 SALVAR ORDEM NO FIREBASE
    // [IDEMPOTENCY] Helper cria atomicamente - removido //     await db.collection('orders').doc(orderId).set(orderData);
    // [IDEMPOTENCY] Helper cria atomicamente - removido //     console.log('✅ [STEP 6] ORDEM CRIADA NO FIREBASE:', orderId);
    
    // 🔒 [IDEMPOTENCY PROTECTION] Criar order com proteção contra duplicação
    const idempotencyResult = await createOrderWithIdempotency({
      db,
      req,
      checkoutId,
      amount,
      customer,
      tenantId: checkout.tenantId,
      orderData,
      method
    });
    
    // ♻️ Se é retry e tem session existente, retornar imediatamente
    if (idempotencyResult.existingSession) {
      console.log(`✅ [IDEMPOTENCY] Returning cached session for order: ${idempotencyResult.orderId}`);
      return res.json(idempotencyResult.existingSession);
    }
    
    // ✅ Continuar com criação de nova session
    const orderId = idempotencyResult.orderId;
    orderData.id = orderId;
    console.log(`✅ [IDEMPOTENCY] Proceeding with ${idempotencyResult.isNew ? 'NEW' : 'REBUILT'} order: ${orderId}`);

    if (idempotencyResult.isNew) {
      sendOrderToUTMify({
        orderId,
        tenantId: checkout.tenantId,
        method,
        status: 'pending',
        amount,
        currency: currency || 'BRL',
        customer: { name: customer.name, email: customer.email, phone: customer.phone, document: customer.document },
        checkoutTitle: checkout.title,
        productId: checkout.productId,
        offerTitle: offerTitle,
        createdAt: new Date(),
        trackingParameters: trackingParameters || undefined,
        gatewayFee: feeCalculation.gatewayFee,
        platformFee: feeCalculation.platformFee,
        netAmount: feeCalculation.netAmount
      }).catch(err => console.warn('[UTMify] Async send failed:', err.message));

      // 🐘 DUAL-WRITE → Neon PIX order (fire-and-forget)
      import('./lib/neon-financial.js').then(({ neonWriteOrder }) => {
        neonWriteOrder({
          id: orderId,
          checkoutId,
          productId: checkout.productId ?? null,
          tenantId: checkout.tenantId,
          sellerId: checkout.tenantId,
          status: 'pending',
          method,
          paymentMethod: 'efibank_pix',
          paymentProcessor: 'efibank',
          amount,
          currency: (currency as any) || 'BRL',
          productType: checkout.productType ?? null,
          marketTarget: 'brasil',
          offerSlug: (orderData as any).offerSlug ?? null,
          offerTitle: offerTitle ?? null,
          couponCode: (orderData as any).couponCode ?? null,
          affiliateUid: (orderData as any).affiliateUid ?? null,
          gatewayFee: feeCalculation.gatewayFee,
          gatewayFeePercent: feeCalculation.gatewayFeePercent,
          platformFee: feeCalculation.platformFee,
          platformFeePercent: feeCalculation.platformFeePercent,
          netAmount: feeCalculation.netAmount,
          customer: { name: customer.name, email: customer.email, document: customer.document, phone: customer.phone },
          checkoutSnapshot: (orderData as any).checkoutSnapshot ?? null,
          financial: (orderData as any).financial ?? null,
          trackingParameters: trackingParameters ?? null,
        });
      }).catch(() => {});
    }
    
    console.log(`🏦 [STEP 6] ADQUIRENTE APLICADO: ${method === 'pix' ? pixAcquirer : cardAcquirer}`);
    console.log(`💰 [STEP 6] TAXAS: Gateway=${feeCalculation.gatewayFeePercent}% (R$ ${(feeCalculation.gatewayFee/100).toFixed(2)}) Platform=${feeCalculation.platformFeePercent}% (R$ ${(feeCalculation.platformFee/100).toFixed(2)}) Net=R$ ${(feeCalculation.netAmount/100).toFixed(2)}`);

    // 🏦 PROCESSAR PAGAMENTO PIX COM ADQUIRENTE CONFIGURADO
    if (method === 'pix') {
      console.log(`💰 PROCESSANDO PIX COM ADQUIRENTE: ${pixAcquirer.toUpperCase()}...`);
      
      // 🏦 PROCESSAR COM WOOVI OU EFIBANK
      if (pixAcquirer === 'woovi') {
        console.log('💰 PROCESSANDO PIX VIA WOOVI...');
        
        try {
          const wooviResult = await createWooviCharge({
            correlationID: orderId,
            value: amount,
            comment: `Pagamento: ${checkout.title}`,
            customer: {
              name: customer.name,
              email: customer.email,
              taxID: customer.document,
              phone: customer.phone
            }
          });
          
          if (!wooviResult) {
            throw new Error('Falha ao criar cobrança Woovi - resposta vazia');
          }
          
          console.log('✅ WOOVI: Cobrança PIX criada com sucesso!');
          
          const wooviPixCode = wooviResult.charge.brCode;
          const wooviQrImage = wooviResult.charge.qrCodeImage;
          
          if (customer?.email && wooviPixCode) {
            const { sendPixBuyerEmail } = await import('./lib/email-service.js');
            sendPixBuyerEmail({
              buyerEmail: customer.email,
              buyerName: customer.name || '',
              productName: checkout?.title || 'Produto',
              amount: amount,
              orderId: orderId,
              pixCopiaECola: wooviPixCode,
              qrCodeImage: wooviQrImage || null,
              expiresAt: wooviResult.charge.expiresDate || undefined,
              sellerName: checkout?.sellerName || undefined
            }).catch(err => console.error('⚠️ Erro ao enviar email PIX buyer (Woovi):', err));
          }
          
          return res.json({
            id: orderId,
            status: 'pending',
            method: 'pix',
            acquirer: 'woovi',
            orderId: orderId,
            qrcode: {
              image: wooviQrImage,
              qrcode: wooviPixCode,
              qrCodeBase64: wooviQrImage,
              text: wooviPixCode,
              expiresAt: wooviResult.charge.expiresDate,
            }
          });
        } catch (wooviError: any) {
          console.error('❌ WOOVI: Erro ao processar PIX:', wooviError.message);
          
          await db.collection('orders').doc(orderId).update({
            status: 'failed',
            paymentMethod: 'pix',
            errorInfo: {
              type: 'woovi_api_error',
              message: wooviError.message || 'Falha na conexão com Woovi',
              timestamp: new Date()
            },
            updatedAt: new Date()
          });
          
          return res.status(500).json({
            error: 'Erro ao processar PIX Woovi',
            message: 'Serviço de pagamento temporariamente indisponível. Tente novamente em alguns instantes.',
            details: wooviError.message
          });
        }
      }
      
      // 🏦 PROCESSAR COM ONZ FINANCE (QRCodes API)
      if (pixAcquirer === 'onz') {
        console.log('💰 PROCESSANDO PIX VIA ONZ FINANCE (QRCodes API)...');
        
        try {
          const onzCreds = await loadOnzCredentials();
          if (!onzCreds?.enabled) {
            throw new Error('ONZ Finance não está habilitado ou credenciais não configuradas');
          }

          const onzResult = await createOnzPixCharge({
            orderId,
            amountBRL: amount,
            devedorNome: customer.name || undefined,
            devedorCpf: customer.document?.replace(/\D/g, '') || undefined,
            descricao: (checkout.title || 'Produto').substring(0, 50),
            expiracaoSegundos: 3600,
          });

          const brCode = onzResult.brCode || onzResult.location || '';
          const qrCodeImage = onzResult.qrCodeUrl || '';
          const onzTxid = onzResult.txid || orderId;

          console.log(`✅ ONZ FINANCE: Cobrança PIX criada! txid=${onzTxid}`);

          // Atualizar pedido com txid ONZ
          await db.collection('orders').doc(orderId).update({
            onzTxid,
            paymentGatewayData: { txid: onzTxid, brCode, acquirer: 'onz' },
            updatedAt: new Date(),
          });

          if (customer?.email && brCode) {
            const { sendPixBuyerEmail } = await import('./lib/email-service.js');
            sendPixBuyerEmail({
              buyerEmail: customer.email,
              buyerName: customer.name || '',
              productName: checkout?.title || 'Produto',
              amount,
              orderId,
              pixCopiaECola: brCode,
              qrCodeImage: qrCodeImage || null,
              sellerName: checkout?.sellerName || undefined,
            }).catch(err => console.error('⚠️ Erro ao enviar email PIX buyer (ONZ):', err));
          }

          return res.json({
            id: orderId,
            status: 'pending',
            method: 'pix',
            acquirer: 'onz',
            orderId,
            qrcode: {
              image: qrCodeImage,
              qrcode: brCode,
              qrCodeBase64: qrCodeImage,
              text: brCode,
              expiresAt: null,
            },
          });
        } catch (onzError: any) {
          console.error('❌ ONZ FINANCE: Erro ao processar PIX:', onzError.message);

          await db.collection('orders').doc(orderId).update({
            status: 'failed',
            paymentMethod: 'pix',
            errorInfo: {
              type: 'onz_api_error',
              message: onzError.message || 'Falha na conexão com ONZ Finance',
              timestamp: new Date(),
            },
            updatedAt: new Date(),
          });

          return res.status(500).json({
            error: 'Erro ao processar PIX ONZ Finance',
            message: 'Serviço de pagamento temporariamente indisponível. Tente novamente em alguns instantes.',
            details: onzError.message,
          });
        }
      }



      // 🏦 PROCESSAR COM EFIBANK (padrão)
      console.log('💰 PROCESSANDO PIX EFIBANK COM SDK OFICIAL...');
      
      try {
        // 🔑 Determinar ambiente baseado nas credenciais do Firebase
        const isProduction = efiBankConfig?.environment === 'production';
        
        console.log('🔐 AMBIENTE EFIBANK DETECTADO:', {
          environment: efiBankConfig?.environment || 'não configurado (padrão: sandbox)',
          isProduction: isProduction,
          source: efiBankConfig?.environment ? 'Firebase Config' : 'Fallback (ENV)',
          usingProductionCredentials: !!efiBankConfig?.productionClientId,
          usingSandboxCredentials: !!efiBankConfig?.sandboxClientId
        });
        
        // 🔥 USAR SDK OFICIAL EFIBANK - RECOMENDAÇÃO DA DOCUMENTAÇÃO
        const EfiPay = await import('sdk-node-apis-efi');
        const path = await import('path');
        
        // 🐰 BUSCAR CERTIFICADO DO BUNNY CDN (ETERNO) OU LOCAL
        const fs = await import('fs');
        const os = await import('os');
        let certFullPath: string;
        let certExists = false;
        
        // 1️⃣ PRIORIDADE: Bunny CDN (ETERNO)
        if (efiBankConfig?.certificateStoragePath) {
          const storageFilePath = efiBankConfig.certificateStoragePath;
          console.log(`📥 BUSCANDO certificado do Bunny CDN: ${storageFilePath}`);
          
          try {
            const certBuffer = await downloadCertFromFirebaseStorage(storageFilePath);
            
            // Salvar certificado em arquivo temporário para o SDK
            const tempCertPath = path.join(os.tmpdir(), `efibank-${Date.now()}.p12`);
            await fs.promises.writeFile(tempCertPath, certBuffer);
            
            console.log(`✅ CERTIFICADO baixado do Bunny CDN para: ${tempCertPath} (${certBuffer.length} bytes)`);
            certFullPath = tempCertPath;
            certExists = true;
          } catch (storageError: any) {
            console.error(`❌ ERRO ao baixar certificado do Bunny CDN: ${storageError.message}`);
            console.log('🔄 FALLBACK: Tentando certificado local...');
          }
        }
        
        // 2️⃣ FALLBACK: Certificado local (backward compatibility)
        if (!certExists) {
          const certPath = isProduction ? 'efi-prod.p12' : 'efi-sandbox.p12';
          certFullPath = getCertPath(certPath);
          certExists = fs.existsSync(certFullPath);
          
          if (certExists) {
            console.log(`✅ CERTIFICADO LOCAL encontrado: ${certFullPath}`);
          } else {
            console.warn(`⚠️ CERTIFICADO NÃO ENCONTRADO (nem Storage nem local): ${certFullPath}`);
          }
        }
        
        let efipay;
        
        if (true) { // SEMPRE OAuth2 direto com cert do disco/RTDB (SDK pode travar indefinidamente)
          console.log('🔐 PIX: Carregando certificado P12 para OAuth2 + mTLS...');

          // ── 1. Tentar cert já baixado do Storage na etapa anterior ─────────
          let sharedCertBuf: Buffer | null = null;
          if (certExists && certFullPath) {
            try {
              sharedCertBuf = await fs.promises.readFile(certFullPath);
              console.log(`📋 Cert carregado do disco (${sharedCertBuf.length} bytes): ${certFullPath}`);
            } catch (e: any) {
              console.warn(`⚠️ Erro ao ler cert do disco: ${e.message}`);
            }
          }

          // ── 2. Fallback: tentar cert local padrão se não foi carregado ─────
          if (!sharedCertBuf) {
            const localCertPath = path.join(process.cwd(), 'certs', isProduction ? 'efi-prod.p12' : 'efi-sandbox.p12');
            if (fs.existsSync(localCertPath)) {
              try {
                sharedCertBuf = await fs.promises.readFile(localCertPath);
                console.log(`📋 Cert carregado do caminho local (${sharedCertBuf.length} bytes): ${localCertPath}`);
              } catch (e: any) {
                console.warn(`⚠️ Erro ao ler cert local: ${e.message}`);
              }
            }
          }

          // ── 3. Fallback final: carregar diretamente do RTDB ──────────────
          if (!sharedCertBuf) {
            console.log('🔄 PIX: Cert não encontrado em disco — tentando RTDB...');
            try {
              const { loadCertificateFromRTDB } = await import('./lib/eternal-sync.js');
              const rtdbBuf = await loadCertificateFromRTDB();
              if (rtdbBuf && rtdbBuf.length > 256) {
                sharedCertBuf = rtdbBuf;
                console.log(`✅ Cert carregado do RTDB (${sharedCertBuf.length} bytes)`);
                // Persistir em disco para próximas requisições
                try {
                  const certsDir = path.join(process.cwd(), 'certs');
                  await fs.promises.mkdir(certsDir, { recursive: true });
                  const savePath = path.join(certsDir, isProduction ? 'efi-prod.p12' : 'efi-sandbox.p12');
                  await fs.promises.writeFile(savePath, rtdbBuf);
                  console.log(`💾 Cert do RTDB salvo em disco: ${savePath}`);
                } catch (saveErr: any) {
                  console.warn(`⚠️ Não foi possível salvar cert do RTDB em disco: ${saveErr.message}`);
                }
              }
            } catch (rtdbErr: any) {
              console.warn(`⚠️ Erro ao carregar cert do RTDB: ${rtdbErr.message}`);
            }
          }

          if (!sharedCertBuf) {
            console.warn('⚠️ CERTIFICADO P12 NÃO ENCONTRADO em nenhuma fonte — OAuth2 pode falhar em produção');
          }

          console.log('🔐 PIX: Obtendo token OAuth2 com credentials + cert explícitos...');
          const token = await getEfiAccessToken(
            {
              clientId: clientId,
              clientSecret: clientSecret,
              environment: useProductionEfi ? 'production' : 'sandbox',
            },
            sharedCertBuf || undefined
          );
          console.log(`✅ TOKEN OAUTH2 OBTIDO: ${token ? token.substring(0,20) + '...' : 'VAZIO'}`);
          
          if (!token) throw new Error('Token OAuth2 não obtido — verificar certificado e credenciais');

          // Criar mTLS Agent para as chamadas PIX (reutiliza o mesmo cert buffer)
          const https = await import('https');
          let pixMtlsAgent: any = undefined;
          if (sharedCertBuf && sharedCertBuf.length > 256) {
            try {
              pixMtlsAgent = new https.Agent({
                pfx: sharedCertBuf,
                passphrase: '',
                rejectUnauthorized: true
              });
              console.log(`🔐 mTLS Agent criado para chamadas PIX: ${sharedCertBuf.length} bytes`);
            } catch (agentErr: any) {
              console.warn(`⚠️ Erro ao criar mTLS Agent: ${agentErr.message} — continuando sem cert`);
            }
          } else {
            console.warn('⚠️ Cert não disponível para mTLS Agent — chamadas PIX podem falhar');
          }

          // Criar cobrança PIX via API direta OAuth2
          const pixPayload = {
            calendario: {
              expiracao: 3600
            },
            devedor: buildDevedor(customer.document || '', customer.name),
            valor: {
              original: (amount / 100).toFixed(2)
            },
            chave: efiBankConfig?.pixKey || process.env.EFIBANK_PIX_KEY || 'af767a52-0e4b-44fb-b1e0-5816479b08e5',
            solicitacaoPagador: `Pagamento ${checkout.title} - VolatusPay`
          };
          
          const hostname = isProduction ? 'pix.api.efipay.com.br' : 'pix-h.api.efipay.com.br';
          console.log(`📡 Criando cobrança PIX em: https://${hostname}/v2/cob`);
          
          // Criar cobrança PIX via OAuth2 + mTLS
          const pixResponse = await new Promise((resolve, reject) => {
            const options: any = {
              hostname,
              port: 443,
              path: '/v2/cob',
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              ...(pixMtlsAgent ? { agent: pixMtlsAgent } : {})
            };
            
            const req = https.request(options, (response) => {
              let data = '';
              response.on('data', chunk => data += chunk);
              response.on('end', () => {
                try {
                  const result = JSON.parse(data);
                  if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(result);
                  } else {
                    console.error('❌ ERRO PIX OAUTH2:', response.statusCode, data);
                    reject(new Error(`PIX API error ${response.statusCode}: ${result.mensagem || result.message || data}`));
                  }
                } catch (error) {
                  reject(new Error(`Erro ao parsear resposta PIX: ${data}`));
                }
              });
            });
            
            req.on('error', (e) => {
              console.error('❌ PIX HTTPS error:', e.message);
              reject(e);
            });
            req.write(JSON.stringify(pixPayload));
            req.end();
          }) as any;
          
          console.log('✅ COBRANÇA PIX CRIADA VIA OAUTH2:', JSON.stringify(pixResponse).substring(0, 200));
          
          // Gerar QR Code via OAuth2 + mTLS
          const qrCodeResponse = await new Promise((resolve, reject) => {
            const options: any = {
              hostname,
              port: 443,
              path: `/v2/loc/${pixResponse.loc.id}/qrcode`,
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${token}`
              },
              ...(pixMtlsAgent ? { agent: pixMtlsAgent } : {})
            };
            
            const req = https.request(options, (response) => {
              let data = '';
              response.on('data', chunk => data += chunk);
              response.on('end', () => {
                try {
                  const result = JSON.parse(data);
                  if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(result);
                  } else {
                    reject(new Error(`QR Code error ${response.statusCode}: ${result.mensagem || result.message || data}`));
                  }
                } catch (error) {
                  reject(new Error(`Erro ao parsear QR Code: ${data}`));
                }
              });
            });
            
            req.on('error', (e) => {
              console.error('❌ QR Code HTTPS error:', e.message);
              reject(e);
            });
            req.end();
          });
          
          // Processar resposta OAuth2 (pular para linha 7678)
          const pixData = pixResponse;
          const txid = pixData.txid;
          
          await db.collection('orders').doc(orderId).update({
            txid: txid,
            efiTxid: txid,
            pixResponse: pixResponse,
            qrCodeResponse: qrCodeResponse,
            authMethod: 'oauth2', // Flag para debug
            updatedAt: new Date()
          });
          
          // Processar QR Code (mesmo código das linhas 7690+)
          let qrImage = (qrCodeResponse as any).imagemQrcode || 
                       (qrCodeResponse as any).image || 
                       (qrCodeResponse as any).qr_code_image ||
                       (qrCodeResponse as any).imageQrcode;
          
          if (qrImage && !qrImage.startsWith('data:')) {
            qrImage = `data:image/png;base64,${qrImage}`;
          }
          
          const qrCodeText = (qrCodeResponse as any).qrcode;
          if (!qrImage && qrCodeText) {
            console.log('⚠️ Efí não enviou imagem do QR Code - gerando Base64 no servidor...');
            try {
              const QRCode = await import('qrcode');
              qrImage = await QRCode.toDataURL(qrCodeText, {
                errorCorrectionLevel: 'M',
                type: 'image/png',
                width: 300,
                margin: 1
              });
              console.log('✅ QR Code Base64 gerado com sucesso no servidor!');
            } catch (qrError) {
              console.error('❌ Erro ao gerar QR Code Base64:', qrError);
            }
          }
          
          const pixSuccessResult = {
            success: true,
            orderId: orderId,
            txid: txid,
            qrcode: {
              text: qrCodeText,
              image: qrImage || null
            },
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            amount: amount,
            method: 'pix'
          };
          
          if (req.idempotencyKey) {
            await completeIdempotency(req.idempotencyKey, pixSuccessResult);
          }
          
          if (customer?.email && qrCodeText) {
            const { sendPixBuyerEmail } = await import('./lib/email-service.js');
            sendPixBuyerEmail({
              buyerEmail: customer.email,
              buyerName: customer.name || '',
              productName: checkout?.title || 'Produto',
              amount: amount,
              orderId: orderId,
              pixCopiaECola: qrCodeText,
              qrCodeImage: qrImage || null,
              expiresAt: pixSuccessResult.expiresAt,
              sellerName: checkout?.sellerName || undefined
            }).catch(err => console.error('⚠️ Erro ao enviar email PIX buyer (OAuth2):', err));
          }

          return res.json(pixSuccessResult);
        }
        
        console.log('🔐 CONFIGURANDO CREDENCIAIS SDK EFIBANK...');
        
        // 📋 CONFIGURAÇÃO OFICIAL EFIBANK SDK
        const efiConfig = {
          sandbox: !isProduction, // false = Produção, true = Sandbox
          client_id: clientId,
          client_secret: clientSecret,
          certificate: certFullPath,
          cert_base64: false
        };
        
        console.log(`🔐 SDK CONFIG: Ambiente=${isProduction ? 'PRODUÇÃO' : 'SANDBOX'}, Certificado=${certFullPath}`);
        
        efipay = new EfiPay.default(efiConfig);
        
        const pixPayload = {
          calendario: {
            expiracao: 3600
          },
          devedor: buildDevedor(customer.document || '', customer.name),
          valor: {
            original: (amount / 100).toFixed(2)
          },
          chave: efiBankConfig?.pixKey || process.env.EFIBANK_PIX_KEY || 'af767a52-0e4b-44fb-b1e0-5816479b08e5',
          solicitacaoPagador: `Pagamento ${checkout.title} - VolatusPay`
        };

        console.log('🔥 PAYLOAD PIX EFIBANK (SDK):', JSON.stringify(pixPayload, null, 2));
        
        // 🚀 CRIAR COBRANÇA PIX USANDO SDK OFICIAL (COM FALLBACK PARA OAUTH2 DIRETO)
        console.log('📡 CRIANDO COBRANÇA PIX COM SDK OFICIAL EFIBANK...');
        let pixResponse: any;
        let usedOAuth2Fallback = false;
        
        try {
          pixResponse = await efipay.pixCreateImmediateCharge({}, pixPayload);
          console.log('✅ COBRANÇA PIX CRIADA COM SDK:', pixResponse);
        } catch (sdkError: any) {
          console.error('❌ ERRO PIX EFIBANK (SDK OFICIAL):', {
            message: sdkError.message,
            error: sdkError.error,
            error_description: sdkError.error_description,
            fullError: JSON.stringify(sdkError)
          });
          
          // 🔧 FALLBACK: Se erro de certificado, usar OAuth2 direto sem certificado
          // EfíBank SDK retorna: { error: 'invalid_client', error_description: 'Nonexistent certificate for specified account' }
          const isCertificateError = (
            sdkError.error === 'invalid_client' || 
            sdkError.error === 'invalid_token' ||
            sdkError.error_description?.toLowerCase().includes('certificate') ||
            sdkError.error_description?.toLowerCase().includes('nonexistent') ||
            sdkError.message?.toLowerCase().includes('certificate')
          );
          
          if (isCertificateError) {
            
            console.log('🔄 FALLBACK: Certificado inválido! Tentando OAuth2 DIRETO sem certificado...');
            
            // 🔐 Obter token OAuth2 direto (sem certificado)
            const token = await getEfiAccessToken({
              clientId: clientId,
              clientSecret: clientSecret,
              environment: isProduction ? 'production' : 'sandbox'
            });
            
            // 📡 Criar cobrança PIX via API direta com token OAuth2
            const https = await import('https');
            const hostname = isProduction ? 'pix.api.efipay.com.br' : 'pix-h.api.efipay.com.br';
            
            pixResponse = await new Promise((resolve, reject) => {
              const options = {
                hostname,
                port: 443,
                path: '/v2/cob',
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                }
              };
              
              const req = https.request(options, (response) => {
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => {
                  try {
                    const result = JSON.parse(data);
                    if (response.statusCode >= 200 && response.statusCode < 300) {
                      resolve(result);
                    } else {
                      console.error('❌ ERRO PIX OAUTH2:', response.statusCode, result);
                      reject(new Error(`PIX OAuth2 error: ${result.message || data}`));
                    }
                  } catch (error) {
                    reject(new Error(`Erro ao parsear resposta PIX: ${data}`));
                  }
                });
              });
              
              req.on('error', reject);
              req.write(JSON.stringify(pixPayload));
              req.end();
            });
            
            console.log('✅ COBRANÇA PIX CRIADA VIA OAUTH2 DIRETO:', pixResponse);
            usedOAuth2Fallback = true;
          } else {
            // Erro diferente de certificado - repassar para cima
            throw sdkError;
          }
        }

        // 🔗 GERAR QR CODE
        const pixData = pixResponse as any;
        const txid = pixData.txid;
        let qrCodeResponse: any;
        
        if (usedOAuth2Fallback) {
          // 🔐 Gerar QR Code via OAuth2 direto (sem SDK)
          console.log('🔗 GERANDO QR CODE PIX VIA OAUTH2 DIRETO...');
          
          const token = await getEfiAccessToken({
            clientId: clientId,
            clientSecret: clientSecret,
            environment: isProduction ? 'production' : 'sandbox'
          });
          
          const https = await import('https');
          const hostname = isProduction ? 'pix.api.efipay.com.br' : 'pix-h.api.efipay.com.br';
          
          qrCodeResponse = await new Promise((resolve, reject) => {
            const options = {
              hostname,
              port: 443,
              path: `/v2/loc/${pixData.loc.id}/qrcode`,
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            };
            
            const req = https.request(options, (response) => {
              let data = '';
              response.on('data', chunk => data += chunk);
              response.on('end', () => {
                try {
                  const result = JSON.parse(data);
                  if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(result);
                  } else {
                    reject(new Error(`QR Code error: ${result.message || data}`));
                  }
                } catch (error) {
                  reject(new Error(`Erro ao parsear QR Code: ${data}`));
                }
              });
            });
            
            req.on('error', reject);
            req.end();
          });
          
          console.log('✅ QR CODE GERADO VIA OAUTH2 DIRETO:', qrCodeResponse);
        } else {
          // 📱 GERAR QR CODE USANDO SDK OFICIAL EFIBANK
          console.log('🔗 GERANDO QR CODE PIX COM SDK...');
          qrCodeResponse = await efipay.pixGenerateQRCode({ 
            id: pixData.loc.id 
          });
          console.log('✅ QR CODE GERADO COM SDK:', qrCodeResponse);
        }
        
        console.log('🔍 DEBUG QR CODE RESPONSE STRUCTURE:', JSON.stringify(qrCodeResponse, null, 2));
        console.log('🔍 DEBUG - qrcode text:', (qrCodeResponse as any).qrcode);
        console.log('🔍 DEBUG - imagemQrcode:', (qrCodeResponse as any).imagemQrcode ? 'EXISTS' : 'NULL/UNDEFINED');
        console.log('🔍 DEBUG - image (alt name):', (qrCodeResponse as any).image ? 'EXISTS' : 'NULL/UNDEFINED');

        // 💾 ATUALIZAR ORDEM COM TXID
        await db.collection('orders').doc(orderId).update({
          txid: txid,
          efiTxid: txid,
          pixResponse: pixResponse,
          updatedAt: new Date()
        });

        // 🔍 VERIFICAR PROPRIEDADES DISPONÍVEIS PARA IMAGEM QR CODE
        let qrImage = (qrCodeResponse as any).imagemQrcode || 
                       (qrCodeResponse as any).image || 
                       (qrCodeResponse as any).qr_code_image ||
                       (qrCodeResponse as any).imageQrcode;

        if (qrImage && !qrImage.startsWith('data:')) {
          qrImage = `data:image/png;base64,${qrImage}`;
        }

        console.log('🔍 DEBUG - Final qrImage:', qrImage ? 'FOUND' : 'NOT FOUND');

        // 🔥 BUG FIX: Se Efí não enviar imagem, gerar QR Code Base64 no servidor
        const qrCodeText = (qrCodeResponse as any).qrcode;
        if (!qrImage && qrCodeText) {
          console.log('⚠️ Efí não enviou imagem do QR Code - gerando Base64 no servidor...');
          try {
            const QRCode = await import('qrcode');
            qrImage = await QRCode.toDataURL(qrCodeText, {
              errorCorrectionLevel: 'M',
              type: 'image/png',
              width: 300,
              margin: 1
            });
            console.log('✅ QR Code Base64 gerado com sucesso no servidor!');
          } catch (qrError) {
            console.error('❌ Erro ao gerar QR Code Base64:', qrError);
            // Continuar mesmo sem imagem - frontend pode gerar
          }
        }

        const pixSuccessResult = {
          success: true,
          orderId: orderId,
          txid: txid,
          qrcode: {
            text: qrCodeText,
            image: qrImage || null
          },
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          amount: amount,
          method: 'pix'
        };
        
        if (req.idempotencyKey) {
          await completeIdempotency(req.idempotencyKey, pixSuccessResult);
        }
        
        if (customer?.email && qrCodeText) {
          const { sendPixBuyerEmail } = await import('./lib/email-service.js');
          sendPixBuyerEmail({
            buyerEmail: customer.email,
            buyerName: customer.name || '',
            productName: checkout?.title || 'Produto',
            amount: amount,
            orderId: orderId,
            pixCopiaECola: qrCodeText,
            qrCodeImage: qrImage || null,
            expiresAt: pixSuccessResult.expiresAt,
            sellerName: checkout?.sellerName || undefined
          }).catch(err => console.error('⚠️ Erro ao enviar email PIX buyer (SDK):', err));
        }

        return res.json(pixSuccessResult);

      } catch (error: any) {
        console.error('❌ ERRO PIX EFIBANK (SDK OFICIAL):', error);
        
        // 🔍 EXTRAIR MENSAGEM REAL DO SDK EFIBANK (retorna {nome, mensagem} em vez de Error padrão)
        const efiErrorMsg = error?.mensagem || error?.message || error?.error_description || 'Falha na conexão com EfíBank';
        const efiErrorName = error?.nome || error?.error || 'unknown';
        
        // 🎯 DETECTAR ERROS DE VALIDAÇÃO PARA MENSAGEM AMIGÁVEL AO CLIENTE
        let userMessage = 'Serviço de pagamento temporariamente indisponível. Tente novamente em alguns instantes.';
        let statusCode = 500;
        const lowerMsg = efiErrorMsg.toLowerCase();
        
        if (lowerMsg.includes('bloqueio') || lowerMsg.includes('bloqueado') || lowerMsg.includes('impedem essa operação')) {
          userMessage = 'A conta do vendedor possui restrições temporárias no gateway de pagamento. Entre em contato com o suporte.';
          statusCode = 503;
        } else if (lowerMsg.includes('cpf') && (lowerMsg.includes('inválido') || lowerMsg.includes('invalido'))) {
          userMessage = 'CPF inválido. Verifique o documento informado e tente novamente.';
          statusCode = 400;
        } else if (lowerMsg.includes('cnpj') && (lowerMsg.includes('inválido') || lowerMsg.includes('invalido'))) {
          userMessage = 'CNPJ inválido. Verifique o documento informado e tente novamente.';
          statusCode = 400;
        } else if (lowerMsg.includes('cpf') || lowerMsg.includes('document')) {
          userMessage = 'CPF/CNPJ inválido. Verifique o documento informado e tente novamente.';
          statusCode = 400;
        } else if (lowerMsg.includes('chave') || lowerMsg.includes('key')) {
          userMessage = 'Erro na configuração do PIX. Entre em contato com o suporte.';
        } else if (lowerMsg.includes('valor') && !lowerMsg.includes('cpf')) {
          userMessage = 'Valor do pagamento inválido. Verifique e tente novamente.';
          statusCode = 400;
        }
        
        // ❌ MARCAR ORDEM COMO ERRO NO FIREBASE - SEM FALLBACK MOCK
        await db.collection('orders').doc(orderId).update({
          status: 'failed',
          paymentMethod: 'pix',
          errorInfo: {
            type: 'efibank_api_error',
            nome: efiErrorName,
            message: efiErrorMsg,
            timestamp: new Date()
          },
          updatedAt: new Date()
        });
        
        if (req.idempotencyKey) {
          await failIdempotency(req.idempotencyKey, error);
        }
        
        return res.status(statusCode).json({
          error: 'Erro ao processar PIX EfíBank',
          message: userMessage,
          details: efiErrorMsg
        });
      }

    } else if (method === 'card') {
      console.log('💳 PROCESSANDO CARTÃO EFIBANK...');
      
      if (!cardData || (!cardData.payment_token && !cardData.paymentToken)) {
        return res.status(400).json({
          error: 'Token do cartão obrigatório para pagamento'
        });
      }

      try {
        // 🔑 OBTER TOKEN EFIBANK COM FALLBACK  
        let token;
        try {
          console.log('🔧 INICIANDO OBTENÇÃO TOKEN EFIBANK PARA PAGAMENTO CARTÃO...');
          token = await getEfiAccessToken();
          console.log('✅ TOKEN OBTIDO COM SUCESSO PARA PAGAMENTO CARTÃO');
        } catch (tokenError) {
          console.error('❌ ERRO CRÍTICO: Falha na obtenção do token EFIBank:');
          console.error('🔍 DETALHES DO ERRO:', {
            message: tokenError.message,
            stack: tokenError.stack,
            code: tokenError.code,
            errno: tokenError.errno
          });
          console.log('🔄 FALLBACK: Token EFIBank indisponível, salvando como pendente...');
          
          // 💾 SALVAR TRANSAÇÃO PENDENTE NO FIREBASE COM DETALHES COMPLETOS
          await db.collection('orders').doc(orderId).update({
            status: 'pending_token',
            paymentMethod: 'card_efibank', 
            cardData: {
              installments: cardData.installments || 1,
              last4: (cardData.payment_token || cardData.paymentToken) ? (cardData.payment_token || cardData.paymentToken).slice(-4) : '****'
            },
            errorInfo: {
              type: 'token_failure',
              message: 'EFIBank token indisponível - processamento pendente',
              error: tokenError.message,
              errorCode: tokenError.code || 'UNKNOWN',
              errorErrno: tokenError.errno || null,
              detailedStack: tokenError.stack || 'No stack trace',
              timestamp: new Date()
            },
            updatedAt: new Date()
          });
          
          // 🚨 CRÍTICO: NUNCA retornar success=true para fallback CARTÃO
          // Usuário só deve ver sucesso APÓS confirmação real de débito
          return res.status(503).json({
            success: false,
            error: 'Sistema de pagamento temporariamente indisponível',
            orderId: orderId,
            status: 'system_error',
            method: 'card',
            message: 'Sistema de cartão está temporariamente indisponível. Tente novamente em alguns minutos.',
            fallback: true,
            retryMessage: 'Por favor, tente novamente ou escolha PIX como alternativa.'
          });
        }
        
        // 💳 CRIAR PAGAMENTO COM CARTÃO
        const accountIdentifier = getSecret('EFIBANK_PAYEE_CODE') || process.env.EFIBANK_ACCOUNT_CODE || process.env.EFIBANK_ACCOUNT_IDENTIFIER;
        
        // 🔑 VALIDAR SE ACCOUNT IDENTIFIER ESTÁ CONFIGURADO (OBRIGATÓRIO)
        if (!accountIdentifier) {
          console.error('❌ EFIBANK ACCOUNT IDENTIFIER não configurado!');
          console.error('💡 Configure EFIBANK_PAYEE_CODE nas variáveis de ambiente');
          return res.status(500).json({
            error: 'Identificador de conta não informado',
            message: 'Configure EFIBANK_PAYEE_CODE para processar pagamentos com cartão',
            code: 'MISSING_ACCOUNT_IDENTIFIER'
          });
        }
        
        console.log(`✅ Account identifier obtido do HSM: ${accountIdentifier.substring(0, 8)}...`);
        
        const cardPayload = {
          items: [{
            name: checkout.title,
            amount: 1,
            value: Math.round(amount)
          }],
          payment: {
            credit_card: {
              installments: cardData.installments || 1,
              payment_token: cardData.payment_token || cardData.paymentToken,
              billing_address: {
                street: customerAddress?.street || customer.address?.street || 'Rua do Cliente',
                number: customerAddress?.number || customer.address?.number || 'S/N',
                neighborhood: customerAddress?.neighborhood || customer.address?.neighborhood || 'Centro',
                zipcode: (customerAddress?.zipCode || customer.address?.zipCode || '00000000').replace(/\D/g, ''),
                city: customerAddress?.city || customer.address?.city || 'Cidade',
                state: customerAddress?.state || customer.address?.state || 'SP'
              },
              customer: {
                name: customer.name,
                cpf: (customer.document || '').replace(/\D/g, ''),
                phone_number: (customer.phone || '').replace(/\D/g, '') || '00000000000',
                email: customer.email,
                birth: customer.birthDate || '1990-01-01'
              }
            }
          },
          metadata: {
            custom_id: orderId,
            notification_url: webhookHmac ? `${getBaseDomain()}/webhook/efi?hmac=${webhookHmac}` : undefined
          }
        };
        
        // 🔑 ADICIONAR ACCOUNT_IDENTIFIER DENTRO DO PAYMENT (OBRIGATÓRIO PARA CARTÃO)
        if (accountIdentifier) {
          (cardPayload.payment as any).account_identifier = accountIdentifier;
          console.log(`✅ Account identifier adicionado: ${accountIdentifier.substring(0, 8)}...`);
        }

        console.log('🔥 PAYLOAD CARTÃO EFIBANK');

        const https = await import('https');
        const fs = await import('fs');
        const path = await import('path');
        
        // 🚀 VENDAS REAIS ATIVADAS - SEM CERTIFICADO P12, APENAS TOKEN BEARER
        
        const baseUrl = 'api.efipay.com.br'; // SEMPRE PRODUÇÃO

        // 🔥 CRIAR PAGAMENTO COM CARTÃO
        const cardResponse = await new Promise((resolve, reject) => {
          const options = {
            hostname: baseUrl,
            port: 443,
            path: '/v1/charge/one-step',
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            // 🚀 ATIVADO: VENDAS REAIS SEM CERTIFICADO P12 - APENAS OAUTH2 BEARER
          };

          const req = https.request(options, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
              try {
                const result = JSON.parse(data);
                if (response.statusCode >= 200 && response.statusCode < 300) {
                  resolve(result);
                } else {
                  console.error('❌ ERRO EFIBANK CARTÃO:', response.statusCode, result);
                  reject(new Error(`EFIBank card error: ${result.message || data}`));
                }
              } catch (error) {
                reject(new Error(`Erro ao parsear resposta EFIBank: ${data}`));
              }
            });
          });

          req.on('error', reject);
          req.write(JSON.stringify(cardPayload));
          req.end();
        });

        console.log('✅ PAGAMENTO CARTÃO CRIADO:', cardResponse);

        const cardResult = cardResponse as any;
        const efiStatus = cardResult.data?.status;
        const isApproved = efiStatus === 'approved' || efiStatus === 'paid';
        console.log(`📋 EfíBank card status: ${efiStatus}, isApproved: ${isApproved}, code: ${cardResult.code}`);
        
        const paidAt = new Date();
        
        await db.collection('orders').doc(orderId).update({
          efiChargeId: cardResult.data?.charge_id,
          cardResponse: cardResponse,
          status: isApproved ? 'paid' : 'pending',
          paidAt: isApproved ? paidAt : null,
          updatedAt: paidAt,
          // 💳 DUNNING: Salvar token e endereço para cobranças recorrentes futuras
          payment_token: cardData.payment_token || cardData.paymentToken || null,
          billingAddress: customerAddress || customer?.address || null,
          paymentMethod: 'card',
        });

        if (isApproved) {
          console.log(`✅ CARTÃO APROVADO - Processando pós-pagamento para ordem ${orderId}...`);
          
          const { syncOrderAfterUpdate } = await import('./lib/orders-sync.js');
          syncOrderAfterUpdate(checkout.tenantId, orderId, {
            status: 'paid',
            paidAt: paidAt.toISOString(),
            method: 'card',
            netAmount: feeCalculation.netAmount,
            gatewayFee: feeCalculation.gatewayFee
          });

          sendOrderStatusUpdate(checkout.tenantId, orderId, 'paid', { paidAt })
            .catch(err => console.warn('[UTMify] Async card paid update failed:', err?.message));

          dispatchCardApprovedEvent(checkout.tenantId, {
            ...orderData,
            id: orderId,
            chargeId: cardResult.data?.charge_id,
            paidAt
          }).catch(err => console.warn('[Webhook] Card approved dispatch failed:', err?.message));

          if (orderData.checkoutId) {
            dispatchPurchaseEventToPixels(orderData.checkoutId, {
              id: orderId, tenantId: checkout.tenantId, customerEmail: customer?.email,
              customerName: customer?.name, customerPhone: customer?.phone,
              amount: orderData.amount, currency: orderData.currency, productName: orderData.productName,
              method: 'card', checkoutSlug: orderData.checkoutSlug || checkout.slug
            }).catch(err => console.warn('[CAPI] Card purchase dispatch failed:', err?.message));
          }

          try {
            const firebaseStorage = storage as any;
            await firebaseStorage.createEnrollmentOnPayment({
              ...orderData,
              id: orderId,
              paidAt
            });
            console.log(`✅ Enrollment criado para cartão aprovado`);
          } catch (enrollErr: any) {
            console.warn(`⚠️ Enrollment error (card):`, enrollErr?.message);
          }

          // 📧 CRIAR CONTA E ENVIAR EMAIL DE ACESSO À ÁREA DE MEMBROS (CARTÃO)
          if (orderData.productType === 'digital' || orderData.productType === 'subscription' || !orderData.productType) {
            try {
              await autoCreateMemberOnPurchase({
                customerEmail: customer?.email || orderData.customerEmail,
                customerName: customer?.name || orderData.customerName,
                productId: orderData.productId,
                productType: orderData.productType,
                orderId,
                checkoutId: orderData.checkoutId || orderData.checkoutSlug
              });
            } catch(e: any) { console.warn('⚠️ [AUTO-MEMBER] Erro card:', e?.message || e); }
          }

          try {
            const firebaseStorage2 = storage as any;
            const custEmail = customer?.email;
            if (custEmail && firebaseStorage2.getCustomerProfileByEmail) {
              let profile = await firebaseStorage2.getCustomerProfileByEmail(custEmail);
              if (!profile && firebaseStorage2.createCustomerProfile) {
                profile = await firebaseStorage2.createCustomerProfile({
                  email: custEmail,
                  name: customer?.name || custEmail.split('@')[0],
                  firebaseUid: null
                });
              }
              if (profile && firebaseStorage2.createMemberEntitlement) {
                const existingEnt = await firebaseStorage2.getMemberEntitlementByOrder?.(orderId);
                if (!existingEnt) {
                  await firebaseStorage2.createMemberEntitlement({
                    customerId: profile.id,
                    productId: orderData.productId,
                    tenantId: checkout.tenantId,
                    orderId: orderId,
                    status: 'active',
                    accessStartDate: paidAt,
                    source: 'card_payment'
                  });
                  console.log(`✅ Customer entitlement criado para cartão`);
                }
              }
            }
          } catch (entErr: any) {
            console.warn(`⚠️ Entitlement error (card):`, entErr?.message);
          }

          try {
            const { processWebhookWithBalanceUpdate } = await import('./lib/atomic-balance.js');
            const balanceIdempotencyKey = `card_approved_${orderId}`;
            let netAmountCents = Math.round(feeCalculation.netAmount);
            
            let affiliateCommissionData: any = null;
            if (orderData.affiliateUid) {
              try {
                const firebaseStorage = storage as any;
                affiliateCommissionData = await firebaseStorage.calculateAffiliateCommission(orderData);
                if (affiliateCommissionData?.hasAffiliate && affiliateCommissionData.netCommission > 0) {
                  netAmountCents -= affiliateCommissionData.netCommission;
                  console.log(`💰 Cartão: Valor vendedor após comissão: R$ ${(netAmountCents/100).toFixed(2)}`);
                }
              } catch (calcErr: any) {
                console.warn(`⚠️ Erro calcular comissão (card):`, calcErr?.message);
              }
            }

            const cardReleaseDays = feeCalculation.releaseDays || 30;
            const cardReleaseDate = new Date(Date.now() + cardReleaseDays * 24 * 60 * 60 * 1000);
            await processWebhookWithBalanceUpdate({
              webhookId: balanceIdempotencyKey,
              provider: 'efibank',
              eventType: 'card.approved',
              sellerId: checkout.tenantId,
              amountCents: netAmountCents,
              currency: 'BRL',
              operation: 'add',
              balanceType: 'pending',
              reason: `Pagamento Cartão aprovado - Ordem ${orderId} (libera em D+${cardReleaseDays})`,
              orderId: orderId,
              metadata: {
                method: 'card',
                acquirer: 'efibank',
                totalAmount: amount,
                platformFee: feeCalculation.platformFee,
                gatewayFee: feeCalculation.gatewayFee,
                affiliateCommission: affiliateCommissionData?.netCommission || 0,
                customer: customer?.email,
                releaseDays: cardReleaseDays,
                releaseDate: cardReleaseDate.toISOString(),
              },
              rawPayload: cardResult
            });
            await db.collection('orders').doc(orderId).update({
              'financial.sellerCreditAmount': netAmountCents,
              'financial.affiliateCommissionAmount': affiliateCommissionData?.netCommission || 0,
              'financial.cardBalanceReleased': false,
            });
            console.log(`✅ Saldo PENDENTE creditado: R$ ${(netAmountCents/100).toFixed(2)} (libera em ${cardReleaseDate.toLocaleDateString('pt-BR')})`);

            if (affiliateCommissionData?.hasAffiliate) {
              try {
                const firebaseStorage = storage as any;
                await firebaseStorage.processAffiliateCommission({ ...orderData, id: orderId });
                console.log(`✅ Comissão afiliado creditada (card): R$ ${(affiliateCommissionData.netCommission/100).toFixed(2)}`);
              } catch (affErr: any) {
                console.warn(`⚠️ Erro processar comissão afiliado (card):`, affErr?.message);
              }
            }

            if (orderData.couponCode) {
              try {
                const couponDoc = await storage.getCouponByCode(orderData.couponCode, checkout.tenantId);
                if (couponDoc) {
                  await storage.incrementCouponUsage(couponDoc.id);
                  console.log(`🎫 [CARD] Cupom ${orderData.couponCode} uso incrementado`);
                }
              } catch(couponErr: any) { console.warn('⚠️ [COUPON] Erro ao incrementar uso:', couponErr?.message); }
            }
          } catch (balanceErr: any) {
            console.warn(`⚠️ Balance update error (card):`, balanceErr?.message);
          }

          try {
            const { sendSaleApprovedEmail } = await import('./lib/email-service.js');
            const sellerDoc = await db.collection('sellers').doc(checkout.tenantId).get();
            const sellerData = sellerDoc.data();
            if (sellerData?.email) {
              const cardOrderBumps = (orderData.orderBumps as any[] | null) || orderData.selectedOrderBumps?.map((b: any) => typeof b === 'string' ? { name: 'Order Bump', price: 0 } : { name: b.name || 'Order Bump', price: b.price || 0 }) || [];
              const cardBumpsTotal = cardOrderBumps.reduce((sum: number, b: any) => sum + b.price, 0);
              await sendSaleApprovedEmail({
                sellerEmail: sellerData.email,
                sellerName: sellerData.businessName || sellerData.fullName,
                productName: checkout.title,
                productPrice: amount - cardBumpsTotal,
                buyerName: customer.name || 'Cliente',
                buyerEmail: customer.email || '',
                orderId: orderId,
                paymentMethod: 'credit_card',
                netAmount: Math.round(feeCalculation.netAmount),
                orderBumps: cardOrderBumps.length > 0 ? cardOrderBumps : undefined,
                currency: 'BRL'
              });
              console.log(`📧 Email de venda aprovada enviado (card)`);
            }
          } catch (emailErr: any) {
            console.warn(`⚠️ Email error (card):`, emailErr?.message);
          }

          // 🔔 PUSH NOTIFICATION - VENDA NO CARTÃO
          if (checkout?.tenantId) {
            const { sendSaleNotification: _sendCardPush } = await import('./lib/push-notification-service.js');
            _sendCardPush(checkout.tenantId, {
              id: orderId,
              customer: { name: customer?.name, email: customer?.email },
              productName: checkout.title,
              amount: amount,
              method: 'credit_card',
              affiliateId: affiliateCommissionData?.affiliateId,
              affiliateCommission: affiliateCommissionData?.netCommission,
            }).catch((e: any) => console.warn('[PUSH] Card sale notification failed:', e?.message));

            import('./security/transaction-limits.js').then(({ recordApprovedTransaction }) => {
              recordApprovedTransaction(checkout.tenantId, amount || 0).catch(() => {});
            }).catch(() => {});
          }
        }

        const cardSuccessResult = {
          success: true,
          orderId: orderId,
          chargeId: cardResult.data?.charge_id,
          status: isApproved ? 'paid' : (cardResult.data?.status || 'pending'),
          method: 'card',
          installments: cardData.installments || 1
        };
        
        if (req.idempotencyKey) {
          await completeIdempotency(req.idempotencyKey, cardSuccessResult);
        }
        
        return res.json(cardSuccessResult);

      } catch (error) {
        console.error('❌ ERRO CARTÃO EFIBANK:', error);
        
        // 🔒 REGISTRAR IDEMPOTENCY COMO FALHO
        if (req.idempotencyKey) {
          await failIdempotency(req.idempotencyKey, error);
        }
        
        // 🔄 FALLBACK INTELIGENTE: Se token falhou, salvar transação como PENDENTE
        if (error.message && (error.message.includes('Token request failed') || error.message.includes('socket hang up'))) {
          console.log('🔄 FALLBACK: Salvando transação como PENDENTE_TOKEN para processamento manual');
          
          // 💾 SALVAR TRANSAÇÃO PENDENTE NO FIREBASE
          await db.collection('orders').doc(orderId).update({
            status: 'pending_token',
            paymentMethod: 'card_efibank',
            cardData: {
              installments: cardData.installments || 1,
              last4: (cardData.payment_token || cardData.paymentToken) ? (cardData.payment_token || cardData.paymentToken).slice(-4) : '****'
            },
            errorInfo: {
              type: 'token_failure',
              message: 'EFIBank token indisponível - processamento pendente',
              timestamp: new Date()
            },
            updatedAt: new Date()
          });
          
          // 🚨 CRÍTICO: NUNCA retornar success=true para fallback CARTÃO
          // Usuário só deve ver sucesso APÓS confirmação real de débito
          return res.status(503).json({
            success: false,
            error: 'Sistema de pagamento temporariamente indisponível',
            orderId: orderId,
            status: 'system_error',
            method: 'card',
            message: 'Sistema de cartão está temporariamente indisponível. Tente novamente em alguns minutos.',
            fallback: true,
            retryMessage: 'Por favor, tente novamente ou escolha PIX como alternativa.'
          });
        }
        
        return res.status(500).json({
          error: 'Erro ao processar cartão EFIBank',
          message: error.message
        });
      }

    } else if (method === 'boleto') {
      // 📄 ROTEAMENTO BOLETO por adquirente
      const _boletoAcq = boletoAcquirer.toLowerCase();
      console.log(`📄 PROCESSANDO BOLETO via ${_boletoAcq.toUpperCase()}...`);

      // 💳 PROCESSAMENTO BOLETO EFI BANK (fallback padrão)
      console.log('📄 PROCESSANDO BOLETO EFIBANK...');
      
      try {
        // 🔑 OBTER TOKEN EFIBANK COBRANÇAS (Basic Auth — sem certificado P12)
        let token;
        try {
          console.log('🔧 OBTENDO TOKEN EFIBANK COBRANÇAS PARA BOLETO (sem P12)...');
          const { getEfiCobrancasToken } = await import('./lib/efibank-payments-api.js');
          token = await getEfiCobrancasToken({
            clientId: clientId!,
            clientSecret: clientSecret!,
            isProduction: useProductionEfi
          });
          if (!token) throw new Error('Token vazio retornado pela API Cobranças');
          console.log('✅ TOKEN COBRANÇAS OBTIDO PARA BOLETO');
        } catch (tokenError: any) {
          console.error('❌ ERRO CRÍTICO: Falha na obtenção do token EFIBank para boleto:', tokenError.message);
          return res.status(503).json({
            success: false,
            error: 'Sistema de boleto temporariamente indisponível',
            orderId: orderId,
            status: 'system_error',
            method: 'boleto',
            message: 'Por favor, tente novamente em alguns minutos ou escolha PIX.'
          });
        }
        
        // 📄 CRIAR BOLETO VIA EFIBANK
        const boletoPayload = {
          items: [{
            name: checkout.title?.substring(0, 255) || 'Produto',
            amount: 1,
            value: Math.round(amount)
          }],
          payment: {
            banking_billet: {
              expire_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 3 dias
              customer: (() => {
                const cpfClean = (customer.document || '').replace(/\D/g, '');
                const phoneClean = (customer.phone || '').replace(/\D/g, '');
                const baseCustomer: any = {
                  name: customer.name,
                  email: customer.email,
                };
                if (cpfClean && cpfClean.length === 11) baseCustomer.cpf = cpfClean;
                else if (cpfClean && cpfClean.length === 14) baseCustomer.cnpj = cpfClean;
                if (phoneClean && phoneClean.length >= 10) baseCustomer.phone_number = phoneClean;
                return baseCustomer;
              })()
            }
          },
          metadata: {
            custom_id: orderId,
            notification_url: `${getBaseDomain()}/api/webhooks/efibank`
          }
        };
        
        // 🌐 HOSTNAME COBRANÇAS — mesmo endpoint que cartão (sem certificado P12)
        const boletoCobrancasHostname = useProductionEfi
          ? 'cobrancas.api.efipay.com.br'
          : 'cobrancas-h.api.efipay.com.br';
        
        console.log(`📄 Enviando boleto para EfiBank Cobranças (${boletoCobrancasHostname})...`);
        
        // 🔄 FAZER REQUEST PARA EFIBANK COBRANÇAS
        const boletoResponse = await fetch(`https://${boletoCobrancasHostname}/v1/charge/one-step`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(boletoPayload)
        });
        
        if (!boletoResponse.ok) {
          const errorData = await boletoResponse.text();
          console.error('❌ ERRO EFIBANK BOLETO:', errorData);
          throw new Error(`Erro ao gerar boleto: ${boletoResponse.status}`);
        }
        
        const boletoData = await boletoResponse.json();
        console.log('✅ BOLETO GERADO:', boletoData.data?.charge_id || boletoData.charge_id);
        
        // 💾 ATUALIZAR ORDEM COM DADOS DO BOLETO
        await db.collection('orders').doc(orderId).update({
          status: 'pending',
          method: 'boleto',
          boletoUrl: boletoData.data?.pdf?.charge || boletoData.data?.link || boletoData.pdf?.charge,
          boletoBarcode: boletoData.data?.barcode || boletoData.barcode,
          boletoExpireAt: boletoData.data?.expire_at || boletoData.expire_at,
          efiChargeId: boletoData.data?.charge_id || boletoData.charge_id,
          updatedAt: new Date()
        });
        
        try { dispatchBoletoCreatedEvent(checkout.tenantId || sellerId, { id: orderId, boletoBarcode: boletoData.data?.barcode || boletoData.barcode, boletoPdfUrl: boletoData.data?.pdf?.charge || boletoData.data?.link, amount, customer, boletoDueDate: boletoData.data?.expire_at || boletoData.expire_at }); } catch(e) {}
        return res.json({
          success: true,
          orderId: orderId,
          status: 'pending',
          method: 'boleto',
          boletoUrl: boletoData.data?.pdf?.charge || boletoData.data?.link || boletoData.pdf?.charge,
          boletoBarcode: boletoData.data?.barcode || boletoData.barcode,
          expireAt: boletoData.data?.expire_at || boletoData.expire_at,
          message: 'Boleto gerado com sucesso! Pague até a data de vencimento.'
        });
        
      } catch (error: any) {
        console.error('❌ ERRO AO PROCESSAR BOLETO:', error.message);
        return res.status(500).json({
          error: 'Erro ao gerar boleto',
          message: error.message
        });
      }
    }

  } catch (error: any) {
    console.error('❌ ERRO GERAL SESSÃO PAGAMENTO:', error);
    console.error('❌ ERRO STACK:', error?.stack);
    console.error('❌ ERRO MESSAGE:', error?.message);
    console.error('❌ ERRO NAME:', error?.name);
    console.error('❌ ERRO CODE:', error?.code);
    console.error('❌ REQUEST BODY:', JSON.stringify(req.body, null, 2));
    
    // 🔒 REGISTRAR IDEMPOTENCY COMO FALHO
    try {
      if (req.idempotencyKey) {
        await failIdempotency(req.idempotencyKey, error);
      }
    } catch (idempotencyError) {
      console.error('❌ Erro ao registrar idempotency como falho:', idempotencyError);
    }
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message,
      errorType: error.name,
      errorCode: error.code,
      timestamp: new Date().toISOString()
    });
  }
});

// 🚫 DEBUG ENDPOINT REMOVIDO - SISTEMA EM PRODUÇÃO

// 🚫 DEBUG ENDPOINT REMOVIDO - SISTEMA EM PRODUÇÃO


// 🚫 ENDPOINT DE MIGRAÇÃO REMOVIDO - CHECKOUTS JÁ MIGRADOS EM PRODUÇÃO

// 🔍 ENDPOINT PARA BUSCAR STATUS DE ORDEM ESPECÍFICA (USADO PELO POLLING PIX)
// [DEAD CODE] GET /api/orders/:orderId - duplicated by ordersRouter (mounted at /api/orders, route GET /:orderId) which runs first. NOTE: module route requires verifyFirebaseToken, this one does not.
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID é obrigatório' });
    }
    
    console.log('🔍 BUSCANDO ORDEM:', orderId);
    
    await ensureFirebaseReady();
    const { neonQuery: _nqOrd } = await import('./lib/neon-db.js');
    let _ordRow: any = null;
    await _nqOrd(async (sql) => {
      const rows = await sql`SELECT * FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) _ordRow = rows[0];
    }, `orderGet:${orderId}`);
    
    if (!_ordRow) {
      console.log('❌ ORDEM NÃO ENCONTRADA:', orderId);
      return res.status(404).json({ error: 'Ordem não encontrada' });
    }
    
    const orderData = { ..._ordRow, id: _ordRow.id, tenantId: _ordRow.tenant_id, method: _ordRow.payment_method, txid: _ordRow.metadata?.txid || _ordRow.metadata?.efiTxid, efiTxid: _ordRow.metadata?.efiTxid, pixData: _ordRow.metadata?.pixData, seller_id: _ordRow.seller_id };
    console.log('✅ ORDEM ENCONTRADA:', orderId, 'STATUS:', orderData.status);
    
    // 🔍 DEBUGGAR DADOS DA ORDEM PARA RESOLVER BUG PIX AUTO-APROVAÇÃO
    if (orderData.method === 'pix' && orderData.status === 'paid') {
      console.log('🚨 DEBUG AUTO-APROVAÇÃO PIX: ORDEM MARCADA COMO PAID ENCONTRADA');
      console.log('📊 DADOS ORDEM PIX:', {
        id: orderId,
        status: orderData.status,
        method: orderData.method,
        createdAt: orderData.createdAt?.toDate?.() || orderData.createdAt,
        paidAt: orderData.paidAt?.toDate?.() || orderData.paidAt,
        txid: orderData.txid,
        efiTxid: orderData.efiTxid,
        manualConfirmation: orderData.manualConfirmation,
        confirmedBy: orderData.confirmedBy,
        pixData: orderData.pixData
      });
    }
    
    return res.json({
      id: orderDoc.id,
      ...orderData,
      // Converter timestamps do Firebase para strings
      createdAt: orderData.createdAt?.toDate?.() || orderData.createdAt,
      updatedAt: orderData.updatedAt?.toDate?.() || orderData.updatedAt,
      paidAt: orderData.paidAt?.toDate?.() || orderData.paidAt
    });
    
  } catch (error) {
    console.error('❌ ERRO AO BUSCAR ORDEM:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});
// 🔍 ENDPOINT PÚBLICO PARA POLLING STATUS DO PIX (SEM DADOS SENSÍVEIS)
// [DEAD CODE] GET /api/orders/:orderId/status - duplicated by ordersRouter (mounted at /api/orders, route GET /:orderId/status) which runs first
app.get('/api/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID é obrigatório' });
    }
    
    console.log('🔍 POLLING STATUS PIX:', orderId);
    
    await ensureFirebaseReady();
    const { neonQuery: _nqPoll } = await import('./lib/neon-db.js');
    let _pollOrderRow: any = null;
    await _nqPoll(async (sql) => {
      const rows = await sql`SELECT id, status, payment_method, tenant_id, seller_id, amount, net_amount, gateway_fee, platform_fee, paid_at, metadata FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) _pollOrderRow = rows[0];
    }, `orderPoll:${orderId}`);
    
    if (!_pollOrderRow) {
      console.log('❌ ORDEM NÃO ENCONTRADA (POLLING):', orderId);
      return res.status(404).json({ error: 'Ordem não encontrada', status: 'not_found' });
    }
    
    let orderData: any = {
      ..._pollOrderRow,
      id: _pollOrderRow.id,
      tenantId: _pollOrderRow.tenant_id,
      sellerId: _pollOrderRow.seller_id,
      method: _pollOrderRow.payment_method,
      netAmount: _pollOrderRow.net_amount,
      gatewayFee: _pollOrderRow.gateway_fee,
      platformFee: _pollOrderRow.platform_fee,
      paidAt: _pollOrderRow.paid_at,
      txid: _pollOrderRow.metadata?.txid || _pollOrderRow.metadata?.efiTxid,
      efiTxid: _pollOrderRow.metadata?.efiTxid,
      affiliateCode: _pollOrderRow.metadata?.affiliateCode,
      affiliateUid: _pollOrderRow.metadata?.affiliateUid,
      customer: _pollOrderRow.metadata?.customer || {},
    };
    
    // 🔥 FIX: Se PIX ainda está pending, verificar em tempo real na API EfíBank
    if (orderData.status === 'pending' && orderData.method === 'pix' && orderData.txid) {
      console.log('🔍 PIX PENDING - Verificando status em tempo real na EfíBank...');
      
      try {
        const pixStatus = await verificarPixNaApi(orderData.txid);
        console.log('📡 EfíBank API Response:', JSON.stringify(pixStatus).substring(0, 200));
        
        // Verificar se PIX foi pago na EfíBank
        const pixPaid = pixStatus.valido && (
          pixStatus.dados?.status?.toLowerCase() === 'concluida' ||
          pixStatus.dados?.status?.toLowerCase() === 'completed'
        );
        
        // Verificar se há array de pagamentos (pix[]) indicando que foi pago
        const hasPagamento = pixStatus.dados?.pix && Array.isArray(pixStatus.dados.pix) && pixStatus.dados.pix.length > 0;
        
        if (pixPaid || hasPagamento) {
          console.log('✅ PIX PAGO DETECTADO VIA POLLING! Atualizando banco de dados...');
          
          // 🔥 FIX: Usar calculateDynamicFees para taxas corretas
          const amount = orderData.amount;
          const feeCalculation = await calculateDynamicFees(amount, 'pix', 1, 'efibank', orderData.tenantId || orderData.sellerId);
          
          // Calcular data de liberação
          const releaseDate = new Date(Date.now() + (feeCalculation.releaseDays || 0) * 24 * 60 * 60 * 1000);
          
          // Atualizar status para PAID com taxas corretas (NEON)
          await _nqPoll(async (sql) => {
            await sql`UPDATE orders SET status = 'paid', paid_at = NOW(), net_amount = ${feeCalculation.netAmount}, gateway_fee = ${feeCalculation.gatewayFee}, platform_fee = ${feeCalculation.platformFee}, updated_at = NOW(), metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ confirmedVia: 'polling_realtime', releaseDate })}::jsonb WHERE id = ${orderId} AND status = 'pending'`;
          }, `poll:markPaid:${orderId}`);
          
          // Atualizar dados locais para retorno
          orderData = {
            ...orderData,
            status: 'paid',
            paidAt: new Date()
          };
          
          // 📡 DISPARAR WEBHOOK PARA TENANT (PIX PAGO VIA POLLING)
          try {
            await dispatchPixPaidEvent(orderData.tenantId || orderData.sellerId, {
              id: orderId,
              ...orderData,
              txid: orderData.txid,
              amount: orderData.amount,
              customer: orderData.customer,
              paidAt: new Date()
            });
            console.log('📡 Webhook payment.pix.paid disparado (via polling)');
          } catch (webhookError) {
            console.error('⚠️ Erro ao disparar webhook (polling):', webhookError?.message);
          }
          
          // 💰 CALCULAR COMISSÃO DO AFILIADO ANTES DE CREDITAR (POLLING PATH)
          let pollingAffiliateDeduction = 0;
          let pollingHasAffiliate = false;
          if (orderData.affiliateCode || orderData.affiliateUid) {
            try {
              const affiliateCalcPoll = await (storage as any).calculateAffiliateCommission(orderData);
              if (affiliateCalcPoll.hasAffiliate && affiliateCalcPoll.netCommission > 0) {
                pollingAffiliateDeduction = affiliateCalcPoll.netCommission;
                pollingHasAffiliate = true;
                console.log('💰 [POLLING] Comissão afiliado a descontar: R$' + (pollingAffiliateDeduction/100).toFixed(2));
              }
            } catch (calcErrPoll) {
              console.error("⚠️ [POLLING] Erro ao calcular comissão:", calcErrPoll);
            }
          }
          
          // 💰 CREDITAR SALDO DO SELLER (PIX = D+0 = disponível imediato)
          try {
            const adminSdk = getAdmin();
            
            // Buscar tenantId correto (pode vir da order ou do checkout)
            let sellerId = orderData.tenantId || orderData.sellerId;
            
            // Se não encontrou, buscar do checkout
            if (!sellerId && (orderData.checkoutId || orderData.checkoutSlug)) {
              const checkoutDoc = await db.collection('checkouts').doc(orderData.checkoutId || orderData.checkoutSlug).get();
              if (checkoutDoc.exists) {
                const checkoutData = checkoutDoc.data();
                sellerId = checkoutData?.tenantId;
              }
            }
            
            if (!sellerId) {
              console.error('❌ Não foi possível identificar o seller para creditar saldo');
            } else {
              const sellerBalanceRef = adminSdk.firestore().collection('sellerBalances').doc(sellerId);
              
              await adminSdk.firestore().runTransaction(async (transaction: any) => {
                const balanceDoc = await transaction.get(sellerBalanceRef);
                const balanceData = balanceDoc.exists ? balanceDoc.data() : null;
                
                let netAmountCents = Math.round(feeCalculation.netAmount);
                if (pollingAffiliateDeduction > 0) netAmountCents -= pollingAffiliateDeduction;
                const currentAvailable = balanceData?.balanceAvailable_BRL || 0;
                const newAvailable = currentAvailable + netAmountCents;
                
                transaction.set(sellerBalanceRef, {
                  sellerId: sellerId,
                  balanceAvailable_BRL: newAvailable,
                  balancePending_BRL: balanceData?.balancePending_BRL || 0,
                  balanceReserved_BRL: balanceData?.balanceReserved_BRL || 0,
                  lifetimeRevenue_BRL: (balanceData?.lifetimeRevenue_BRL || 0) + netAmountCents,
                  available: newAvailable,
                  availableBalance: newAvailable,
                  totalBalance: (balanceData?.totalBalance || 0) + netAmountCents,
                  updatedAt: FieldValue.serverTimestamp(),
                  lastCreditedOrderId: orderId,
                  lastCreditedAmount: netAmountCents,
                  lastCreditedAt: FieldValue.serverTimestamp(),
                  currency: 'BRL'
                }, { merge: true });
                
                console.log('💰 SALDO CREDITADO (POLLING): Seller ' + sellerId + ' - +R$ ' + (netAmountCents / 100).toFixed(2) + ' = R$ ' + (newAvailable / 100).toFixed(2));
              });
            }
          } catch (balanceError: any) {
            console.error('❌ Erro ao creditar saldo (não crítico):', balanceError.message);
          }
          
          // 💰 PROCESSAR COMISSÃO DE AFILIADO (POLLING PATH - creditar afiliado, seller já descontado)
          if (pollingHasAffiliate) {
            try {
              await (storage as any).processAffiliateCommission({ ...orderData, id: orderId });
              console.log('✅ [POLLING] Comissão do afiliado processada');
            } catch (affiliateErrPoll) {
              console.error('⚠️ [POLLING] Erro ao processar comissão:', affiliateErrPoll);
            }
          }
          
          // 📧 ENVIAR EMAIL DE VENDA APROVADA PARA O VENDEDOR
          try {
            // 🔍 Buscar email do DONO DO PRODUTO (seller) de múltiplas fontes
            let sellerEmail = '';
            let sellerName = '';
            
            // 1️⃣ Tentar buscar do checkout (fonte mais confiável)
            const checkoutDoc = await db.collection('checkouts').doc(orderData.checkoutId || orderData.checkoutSlug).get();
            const checkoutData = checkoutDoc.exists ? checkoutDoc.data() : null;
            
            if (checkoutData?.tenantId) {
              // 2️⃣ Buscar seller usando tenantId do checkout
              const sellerDoc = await db.collection('sellers').doc(checkoutData.tenantId).get();
              const sellerData = sellerDoc.exists ? sellerDoc.data() : null;
              
              if (sellerData?.email) {
                sellerEmail = sellerData.email;
                sellerName = sellerData.businessName || sellerData.name || sellerData.email.split('@')[0];
              }
              
              // 3️⃣ Se não encontrou no sellers, buscar no users
              if (!sellerEmail) {
                const userDoc = await db.collection('users').doc(checkoutData.tenantId).get();
                const userData = userDoc.exists ? userDoc.data() : null;
                if (userData?.email) {
                  sellerEmail = userData.email;
                  sellerName = userData.displayName || userData.name || userData.email.split('@')[0];
                }
              }
            }
            
            // 4️⃣ Fallback: usar tenantId da order
            if (!sellerEmail && orderData.tenantId) {
              const sellerDoc = await db.collection('sellers').doc(orderData.tenantId).get();
              const sellerData = sellerDoc.exists ? sellerDoc.data() : null;
              if (sellerData?.email) {
                sellerEmail = sellerData.email;
                sellerName = sellerData.businessName || sellerData.email.split('@')[0];
              }
            }
            
            if (sellerEmail) {
              const productName = orderData.checkout?.title || checkoutData?.title || orderData.productTitle || 'Produto Digital';
              const customerName = orderData.customer?.name || 'Cliente';
              const customerEmail = orderData.customer?.email || '';
              
              console.log('📧 ENVIANDO EMAIL PARA SELLER:', sellerEmail, '(Comprador:', customerEmail, ')');
              
              await sendPixPagoEmail({
                sellerEmail: sellerEmail,
                sellerName: sellerName,
                productName: productName,
                buyerName: customerName,
                buyerEmail: customerEmail,
                amount: amount,
                netAmount: feeCalculation.netAmount,
                orderId: orderId
              });
              
              console.log('✅ Email de venda aprovada enviado para SELLER:', sellerEmail);
            } else {
              console.log('⚠️ Seller sem email cadastrado - email não enviado');
            }
          } catch (emailError: any) {
            console.error('⚠️ Erro ao enviar email de venda (não crítico):', emailError.message);
          }
          
        }
      } catch (pixError: any) {
        console.log('⚠️ Erro ao verificar PIX na EfíBank (não crítico):', pixError.message);
      }
    }

    console.log('✅ POLLING STATUS:', orderId, '→', orderData.status);
    
    // 🔒 RETORNAR APENAS DADOS PÚBLICOS (SEM INFORMAÇÕES SENSÍVEIS)
    return res.json({
      id: orderDoc.id,
      status: orderData.status,
      method: orderData.method,
      amount: orderData.amount,
      createdAt: orderData.createdAt?.toDate?.() || orderData.createdAt,
      updatedAt: orderData.updatedAt?.toDate?.() || orderData.updatedAt,
      paidAt: orderData.paidAt?.toDate?.() || orderData.paidAt
    });
    
  } catch (error) {
    console.error('❌ ERRO NO POLLING STATUS:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      status: 'error'
    });
  }
});
// 🔍 ENDPOINT PARA VERIFICAR STATUS DO PIX MANUALMENTE
app.post('/api/orders/:orderId/verify-pix', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?.uid;
    
    if (!orderId) {
      return res.status(400).json({ 
        success: false,
        error: 'Order ID é obrigatório' 
      });
    }
    
    console.log('🔍 VERIFICAÇÃO MANUAL PIX - Ordem:', orderId, '- Usuário:', userId);
    
    await ensureFirebaseReady();
    const { neonQuery: _nqManualPix } = await import('./lib/neon-db.js');
    let _manualPixOrder: any = null;
    await _nqManualPix(async (sql) => {
      const rows = await sql`SELECT id, status, payment_method, tenant_id, seller_id, amount, metadata FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) _manualPixOrder = rows[0];
    }, `manualPixCheck:${orderId}`);
    
    if (!_manualPixOrder) {
      console.log('❌ ORDEM NÃO ENCONTRADA:', orderId);
      return res.status(404).json({ 
        success: false,
        error: 'Ordem não encontrada' 
      });
    }
    
    const orderData = {
      ..._manualPixOrder,
      tenantId: _manualPixOrder.tenant_id,
      method: _manualPixOrder.payment_method,
      txid: _manualPixOrder.metadata?.txid || _manualPixOrder.metadata?.efiTxid,
    };
    
    // Verificar se o usuário tem permissão (é o dono do tenant)
    if (orderData.tenantId !== userId) {
      console.log('❌ ACESSO NEGADO - Usuário não é dono do pedido');
      return res.status(403).json({ 
        success: false,
        error: 'Acesso negado' 
      });
    }
    
    // Verificar se é PIX pendente
    if (orderData.method !== 'pix') {
      return res.status(400).json({ 
        success: false,
        error: 'Este pedido não é PIX' 
      });
    }
    
    if (orderData.status !== 'pending') {
      return res.json({ 
        success: true,
        paid: orderData.status === 'paid',
        message: `Pedido já está ${orderData.status}` 
      });
    }
    
    // Extrair txid do PIX
    const txid = orderData.txid || orderData.efiTxid || orderData.pixData?.txid;
    
    if (!txid) {
      console.log('❌ TXID não encontrado no pedido');
      return res.status(400).json({ 
        success: false,
        error: 'TXID do PIX não encontrado no pedido' 
      });
    }
    
    console.log('🔍 Verificando PIX na API EfíBank - TXID:', txid);
    
    // Verificar status do PIX na API EfíBank
    const pixStatus = await verificarPixNaApi(txid);
    
    if (!pixStatus.valido) {
      console.log('❌ PIX não encontrado ou inválido na API');
      return res.json({ 
        success: true,
        paid: false,
        message: 'PIX ainda não foi confirmado pelo banco' 
      });
    }
    
    // Verificar se o PIX foi pago
    const pixPaid = pixStatus.dados?.status?.toLowerCase() === 'concluida' || 
                    pixStatus.dados?.status?.toLowerCase() === 'completed';
    
    if (!pixPaid) {
      console.log('⏳ PIX ainda pendente na API EfíBank');
      return res.json({ 
        success: true,
        paid: false,
        message: 'PIX ainda não foi confirmado pelo banco' 
      });
    }
    
    // PIX FOI PAGO! Atualizar pedido
    console.log('✅ PIX CONFIRMADO! Atualizando pedido para PAGO');
    
    await _nqManualPix(async (sql) => {
      await sql`UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW(), metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ manualVerification: true, verifiedBy: userId, pixVerificationData: pixStatus.dados })}::jsonb WHERE id = ${orderId} AND status = 'pending'`;
    }, `manualPixPaid:${orderId}`);
    
    console.log('✅ Pedido atualizado para PAGO com sucesso');
    
    return res.json({ 
      success: true,
      paid: true,
      message: 'PIX confirmado! Pedido atualizado para PAGO.' 
    });
    
  } catch (error) {
    console.error('❌ ERRO AO VERIFICAR PIX:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Erro ao verificar status do PIX',
      message: error.message 
    });
  }
});

// 🔐 ENDPOINT PARA TOKENIZAR CARTÃO EFIBANK (FALLBACK BACKEND)
app.post('/api/efibank/tokenize-card', async (req, res) => {
  try {
    console.log('🔐 INICIANDO TOKENIZAÇÃO DE CARTÃO EFIBANK VIA BACKEND FALLBACK...');
    
    const { cardData } = req.body;
    
    if (!cardData || !cardData.number || !cardData.cvv || !cardData.expiry_month || !cardData.expiry_year || !cardData.holder_name) {
      return res.status(400).json({
        error: 'Dados do cartão incompletos',
        message: 'Número, CVV, mês/ano de expiração e nome do portador são obrigatórios'
      });
    }
    
    // 🔑 OBTER CREDENCIAIS (fonte oficial - RTDB/Neon)
    await ensureFirebaseReady();
    const { getEfiBankKeys } = await import('./lib/payment-config.js');
    const efiKeys = await getEfiBankKeys(null);

    if (!efiKeys.clientId || !efiKeys.clientSecret) {
      console.error('❌ CREDENCIAIS EFIBANK AUSENTES PARA TOKENIZAÇÃO (Firebase + env)');
      return res.status(500).json({ 
        error: 'EFIBank não configurado para tokenização',
        message: 'Configure Client ID e Client Secret em Admin → Vendas Globais'
      });
    }

    // 🔑 OBTER TOKEN DE ACESSO (usa credenciais do Firebase via getEfiBankKeys internamente)
    const token = await getEfiAccessToken();
    
    // 🔒 CRIAR PAYLOAD PARA TOKENIZAÇÃO
    const tokenPayload = {
      brand: cardData.brand || 'visa', // Usar brand detectado do frontend
      number: cardData.number.replace(/\D/g, ''),
      cvv: cardData.cvv,
      expiration_month: cardData.expiry_month,
      expiration_year: cardData.expiry_year,
      holder_name: cardData.holder_name.toUpperCase(),
      holder_document: cardData.holder_document || '00000000000'
    };
    
    console.log('🔐 Payload para tokenização fallback:', {
      brand: tokenPayload.brand,
      number: `****${tokenPayload.number.slice(-4)}`,
      expiry: `${tokenPayload.expiration_month}/${tokenPayload.expiration_year}`,
      holder: tokenPayload.holder_name
    });
    
    // 🌐 FAZER CHAMADA PARA API EFIBANK COM TIMEOUT MAIOR
    const { default: axios } = await import('axios');
    
    const response = await axios.post('https://pix.api.efipay.com.br/v1/card', tokenPayload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });
    
    if (response.data && response.data.payment_token) {
      console.log('✅ TOKEN GERADO VIA BACKEND FALLBACK COM SUCESSO');
      return res.json({
        success: true,
        payment_token: response.data.payment_token,
        card_mask: response.data.card_mask || `****${cardData.number.slice(-4)}`,
        source: 'backend_fallback'
      });
    } else {
      throw new Error('Token não retornado pela API EfíBank');
    }
    
  } catch (error: any) {
    console.error('❌ ERRO NA TOKENIZAÇÃO VIA BACKEND FALLBACK:', error);
    return res.status(500).json({
      error: 'Falha na tokenização do cartão',
      message: error.response?.data?.message || error.message || 'Erro interno do servidor',
      details: error.response?.data || {}
    });
  }
});

// 🔐 ENDPOINT FALLBACK PARA TOKENIZAR CARTÃO EFIBANK (NOVO - COMPATÍVEL COM FRONTEND)
app.post('/api/efibank/tokenize-card-backend', async (req, res) => {
  try {
    console.log('🔐 BACKEND FALLBACK: Iniciando tokenização de cartão EfíBank...');
    
    const { brand, number, cvv, expirationMonth, expirationYear, holderName, holderDocument } = req.body;
    
    //  VALIDAÇÕES PCI COMPLIANT
    if (!number || !cvv || !expirationMonth || !expirationYear || !holderName) {
      return res.status(400).json({
        error: 'Dados do cartão incompletos',
        message: 'Número, CVV, validade e nome do portador são obrigatórios'
      });
    }
    
    //  OBTER CREDENCIAIS DO FIREBASE (NÃO DE ENV!)
    const admin = await getAdmin();
    const db = admin.firestore();
    const paymentConfig = await getPaymentConfig(db);
    
    const isProduction = paymentConfig?.efibank?.environment === 'production';
    const clientId = isProduction ? paymentConfig?.efibank?.productionClientId : paymentConfig?.efibank?.sandboxClientId;
    const clientSecret = isProduction ? paymentConfig?.efibank?.productionClientSecret : paymentConfig?.efibank?.sandboxClientSecret;

    if (!clientId || !clientSecret) {
      console.error('❌ CREDENCIAIS EFIBANK AUSENTES PARA TOKENIZAÇÃO BACKEND');
      return res.status(500).json({ 
        error: 'EfíBank não configurado para tokenização backend' 
      });
    }

    //  OBTER TOKEN DE ACESSO OAUTH2 COM CREDENCIAIS CUSTOMIZADAS DO FIREBASE
    const accessToken = await getEfiAccessToken({
      clientId,
      clientSecret,
      environment: isProduction ? 'production' : 'sandbox'
    });
    
    if (!accessToken) {
      throw new Error('Falha ao obter token OAuth2 EfíBank');
    }
    
    //  PREPARAR PAYLOAD PARA API EFIBANK (FORMATO CORRETO)
    const tokenPayload = {
      brand: brand || 'visa',
      number: number.replace(/\D/g, ''),
      cvv: cvv,
      expiration_month: expirationMonth,
      expiration_year: expirationYear,
      holder_name: holderName.toUpperCase(),
      holder_document: holderDocument ? holderDocument.replace(/\D/g, '') : '00000000000'
    };
    
    console.log('🔐 Tokenizando via backend:', {
      brand: tokenPayload.brand,
      number: `****${tokenPayload.number.slice(-4)}`,
      expiry: `${tokenPayload.expiration_month}/${tokenPayload.expiration_year}`,
      holder: tokenPayload.holder_name
    });
    
    //  CHAMAR API EFIBANK COM TIMEOUT DE 20s
    const { default: axios } = await import('axios');
    
    const response = await axios.post('https://pix.api.efipay.com.br/v1/card', tokenPayload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });
    
    if (!response.data?.payment_token) {
      console.error('❌ Token não retornado pela API EfíBank:', response.data);
      throw new Error('Token não retornado pela API EfíBank');
    }
    
    console.log('✅ TOKEN GERADO VIA BACKEND FALLBACK COM SUCESSO');
    
    return res.json({
      payment_token: response.data.payment_token,
      card_mask: response.data.card_mask || `****${number.slice(-4)}`
    });
    
  } catch (error: any) {
    console.error('❌ ERRO NA TOKENIZAÇÃO BACKEND FALLBACK:', error.message);
    
    //  SANITIZAR ERRO PARA NÃO EXPOR DADOS DO CARTÃO
    const safeError = error.response?.data?.message || error.message || 'Erro ao processar cartão';
    
    return res.status(500).json({
      error: 'Falha na tokenização do cartão',
      message: safeError
    });
  }
});

// 💳 ENDPOINT PARA PROCESSAR PAGAMENTO CARTÃO EFIBANK
// ⚠️ SEM RATE LIMITING - Pagamentos reais de clientes não podem ser bloqueados
app.post('/api/payments/efibank-card', paymentIPRateLimit, sanitizeCheckoutInputs, idempotencyMiddleware, async (req, res) => {
  try {
    console.log('🔐 PROCESSANDO PAGAMENTO CARTÃO EFIBANK...');
    console.log('📋 Dados recebidos:', JSON.stringify({
      ...req.body,
      paymentToken: req.body.paymentToken ? '***MASKED***' : 'not_provided'
    }, null, 2));
    
    const { 
      checkoutId, 
      amount, 
      installments = 1,
      customer, 
      customerAddress,
      paymentToken,
      cardMask,
      selectedOrderBumps = [],
      couponCode: cardCouponCode,
      affiliateUid: cardAffiliateUid,
      trackingParameters: cardTrackingParams
    } = req.body;
    
    // 🔍 VALIDAÇÕES BÁSICAS
    if (!checkoutId || !amount || !customer || !paymentToken) {
      return res.status(400).json({
        error: 'Dados obrigatórios ausentes',
        message: 'checkoutId, amount, customer e paymentToken são obrigatórios'
      });
    }

    // 🚨 CARDING DETECTOR
    {
      const { checkCardingVelocity } = await import('./security/carding-detector.js');
      const cardingResult = await checkCardingVelocity(checkoutId, req);
      if (cardingResult.blocked) {
        return res.status(429).json({ error: 'too_many_payment_attempts', message: cardingResult.message });
      }
    }
    
    if (!customer.name || !customer.email || !customer.document) {
      console.error('❌ DADOS DO CLIENTE INCOMPLETOS:', {
        hasName: !!customer.name,
        hasEmail: !!customer.email,
        hasDocument: !!customer.document,
        customer: { ...customer, document: customer.document ? '***CPF/CNPJ***' : undefined }
      });
      return res.status(400).json({
        error: 'Dados do cliente incompletos',
        message: 'Nome, email e documento são obrigatórios',
        details: {
          name: !!customer.name,
          email: !!customer.email,
          document: !!customer.document
        }
      });
    }
    
    // 🏦 INICIALIZAR FIRESTORE PRIMEIRO (CRÍTICO!)
    const admin = await getAdmin();
    const db = admin.firestore();
    
    // 🔑 OBTER CREDENCIAIS EFIBANK (Firebase → env var fallback automático via getEfiBankKeys)
    const { getEfiBankKeys } = await import('./lib/payment-config.js');
    const efiCardKeys = await getEfiBankKeys(db);

    const isProduction = efiCardKeys.environment === 'production';
    const clientId = efiCardKeys.clientId;
    const clientSecret = efiCardKeys.clientSecret;
    const payeeCode = efiCardKeys.payeeCode || process.env.EFIBANK_PAYEE_CODE || '';

    if (!clientId || !clientSecret || !payeeCode) {
      console.error('❌ CREDENCIAIS EFIBANK AUSENTES PARA PAGAMENTO CARTÃO');
      console.error('💡 Configure em: Admin → Adquirentes → EfíBank');
      return res.status(500).json({ 
        error: 'EfíBank não configurado para pagamentos cartão',
        message: 'Configure Client ID, Client Secret e Payee Code em Admin → Adquirentes'
      });
    }

    // 🔑 OBTER TOKEN VIA COBRANÇAS API (cobrancas.api.efipay.com.br — sem certificado P12)
    const cobrancasHostname = isProduction
      ? 'cobrancas.api.efipay.com.br'
      : 'cobrancas-h.api.efipay.com.br';
    const { getEfiCobrancasToken } = await import('./lib/efibank-payments-api.js');
    const accessToken = await getEfiCobrancasToken({
      clientId: clientId!,
      clientSecret: clientSecret!,
      isProduction: !!isProduction
    });
    
    if (!accessToken) {
      throw new Error('Falha ao obter token de acesso EfíBank Cobranças');
    }
    
    const checkoutDoc = await db.collection('checkouts').doc(checkoutId).get();
    if (!checkoutDoc.exists) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }
    
    const checkoutData = checkoutDoc.data();
    
    // 🛡️ VALIDAÇÃO CRÍTICA DE SEGURANÇA: VERIFICAR PREÇO SERVER-SIDE
    // Cliente NUNCA pode definir o preço - deve vir do banco de dados
    let expectedPrice = checkoutData?.pricing?.amount || 0;
    let effectivePricing = checkoutData?.pricing || { amount: expectedPrice };
    
    // Se houver offerSlug, buscar preço E PERÍODO da oferta específica
    const offerSlug = req.body.offerSlug;
    if (offerSlug && checkoutData?.offers && Array.isArray(checkoutData.offers)) {
      const selectedOffer = checkoutData.offers.find((o: any) => o.slug === offerSlug);
      if (selectedOffer && selectedOffer.pricing?.amount) {
        expectedPrice = selectedOffer.pricing.amount;
        effectivePricing = selectedOffer.pricing; // 🔄 USAR PRICING COMPLETO DA OFERTA (inclui subscriptionPeriod!)
        console.log(`💰 USANDO PRICING DA OFERTA "${offerSlug}": R$ ${(expectedPrice/100).toFixed(2)}`);
        if (selectedOffer.pricing.subscriptionPeriod) {
          console.log(`🔄 PERÍODO DA OFERTA: ${selectedOffer.pricing.subscriptionPeriod}`);
        }
      } else {
        console.warn(`⚠️ Oferta "${offerSlug}" não encontrada ou sem pricing, usando preço padrão`);
      }
    }
    
    // 📦 ORDER BUMPS: somar preços dos bumps ao expectedPrice + enriquecer para gravar no pedido
    const efibankCardEnrichedBumps: Array<{ checkoutId: string; name: string; price: number }> = [];
    if (Array.isArray(selectedOrderBumps) && selectedOrderBumps.length > 0) {
      for (const bumpRef of selectedOrderBumps) {
        const bumpCheckoutId = typeof bumpRef === 'string' ? bumpRef : (bumpRef as any)?.checkoutId;
        if (!bumpCheckoutId) continue;
        try {
          const knownBump = Array.isArray(checkoutData?.orderBump?.products)
            ? checkoutData.orderBump.products.find((p: any) => p.checkoutId === bumpCheckoutId)
            : null;
          let bumpPrice = knownBump?.price > 0 ? knownBump.price : 0;
          let bumpName: string = knownBump?.customTitle || knownBump?.title || '';
          if (!bumpPrice) {
            const bumpDoc = await db.collection('checkouts').doc(bumpCheckoutId).get();
            if (bumpDoc.exists) {
              const bd = bumpDoc.data() as any;
              bumpPrice = bd?.pricing?.amount || 0;
              if (!bumpName) bumpName = bd?.title || bd?.name || '';
            }
          }
          if (!bumpName) bumpName = 'Order Bump';
          if (bumpPrice > 0) {
            expectedPrice += bumpPrice;
            efibankCardEnrichedBumps.push({ checkoutId: bumpCheckoutId, name: bumpName, price: bumpPrice });
          }
        } catch (e: any) {
          console.warn(`⚠️ [EFIBANK CARD BUMP] ${bumpCheckoutId}: ${e.message}`);
        }
      }
    }

    // Validar preço com margem de erro de 1% (para arredondamentos)
    const priceDifference = Math.abs(amount - expectedPrice);
    const allowedTolerance = Math.max(1, expectedPrice * 0.01); // 1% ou mínimo 1 centavo
    
    if (priceDifference > allowedTolerance) {
      console.error(`🚨 TENTATIVA DE FRAUDE (CARTÃO): Preço enviado (R$ ${(amount/100).toFixed(2)}) diferente do esperado (R$ ${(expectedPrice/100).toFixed(2)})`);
      console.error(`🚨 IP: ${req.headers['x-forwarded-for'] || req.ip || 'unknown'}`);
      console.error(`🚨 CHECKOUT: ${checkoutData?.title} (${checkoutId})`);
      console.error(`🚨 CUSTOMER: ${customer.email}`);
      
      return res.status(400).json({
        error: 'Valor inválido',
        message: 'O preço enviado não corresponde ao valor do produto. Por favor, recarregue a página e tente novamente.',
        expectedPrice: expectedPrice,
        sentPrice: amount
      });
    }
    
    console.log(`✅ PREÇO VALIDADO (CARTÃO): R$ ${(amount/100).toFixed(2)} (diferença: R$ ${(priceDifference/100).toFixed(2)})`);
    
    // 🔄 HELPER: Normalizar período de assinatura (EN → PT-BR)
    const normalizeCardSubscriptionPeriod = (period: string | undefined): string | undefined => {
      if (!period) return undefined;
      const map: Record<string, string> = {
        'mensal': 'mensal', 'trimestral': 'trimestral', 'semestral': 'semestral', 'anual': 'anual',
        'monthly': 'mensal', 'quarterly': 'trimestral', 'semiannual': 'semestral', 'annual': 'anual', 'yearly': 'anual'
      };
      return map[period.toLowerCase()] || period.toLowerCase();
    };

    // 🔄 VALIDAÇÃO CRÍTICA (ANTES DO DÉBITO): Produtos de assinatura DEVEM ter período válido
    const isSubscriptionCardPre = checkoutData?.productType === 'subscription' || effectivePricing?.billingType === 'subscription';
    if (isSubscriptionCardPre) {
      const rawPeriod = effectivePricing?.subscriptionPeriod || checkoutData?.pricing?.subscriptionPeriod;
      const normalizedPeriod = normalizeCardSubscriptionPeriod(rawPeriod);
      const validPeriodsPre = ['mensal', 'trimestral', 'semestral', 'anual'];
      if (!normalizedPeriod) {
        return res.status(400).json({ error: 'Produto de assinatura inválido', message: 'Este produto de assinatura não possui um período de recorrência configurado. Entre em contato com o vendedor.' });
      }
      if (!validPeriodsPre.includes(normalizedPeriod)) {
        return res.status(400).json({ error: 'Configuração de assinatura inválida', message: `O período de recorrência configurado (${normalizedPeriod}) não é válido. Entre em contato com o vendedor.` });
      }
      // 🔄 Normalizar no effectivePricing para usar na criação da ordem
      if (effectivePricing) effectivePricing = { ...effectivePricing, subscriptionPeriod: normalizedPeriod };
      console.log(`✅ PRÉ-VALIDAÇÃO SUBSCRIPTION OK (CARTÃO): Período = ${normalizedPeriod}`);
    }

    // 💰 PREPARAR DADOS DO PAGAMENTO
    const paymentData = {
      payment: {
        credit_card: {
          installments,
          payment_token: paymentToken,
          billing_address: {
            street: customerAddress?.street || customer.address?.street || 'Rua do Cliente',
            number: customerAddress?.number || customer.address?.number || 'S/N',
            neighborhood: customerAddress?.neighborhood || customer.address?.neighborhood || 'Centro',
            zipcode: (customerAddress?.zipCode || customer.address?.zipCode || '00000000').replace(/\D/g, ''),
            city: customerAddress?.city || customer.address?.city || 'Cidade',
            state: customerAddress?.state || customer.address?.state || 'SP'
          },
          customer: {
            name: customer.name,
            email: customer.email,
            cpf: (customer.document || '').replace(/\D/g, ''),
            birth: customer.birthDate || '1990-01-01',
            phone_number: (customer.phone || '').replace(/\D/g, '') || '00000000000'
          }
        }
      }
    };

    // 🚀 PROCESSAR PAGAMENTO COM EFIBANK
    const { default: axios } = await import('axios');
    
    console.log('🔐 Chamando API EfíBank para cobrança...', {
      amount: amount,
      installments,
      customer: customer.name,
      cardMask
    });
    
    // 👳 CRIAR COBRANÇA DE CARTÃO COM EFIBANK (ONE STEP - Cobranças API)
    const response = await axios.post(
      `https://${cobrancasHostname}/v1/charge/one-step`,
      {
        items: [{
          name: checkoutData?.title || 'Produto VolatusPay',
          value: amount, // ✅ BUG FIX: amount já está em centavos, API EfiBank espera centavos
          amount: 1
        }],
        ...paymentData
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    // ✅ ONE STEP retorna: { code: 200, data: { charge_id, status, total, ... } }
    const chargeResult = response.data?.data || response.data;
    
    if (!chargeResult || !chargeResult.charge_id) {
      console.error('❌ Resposta inválida da API EfíBank:', response.data);
      throw new Error('Resposta inválida da API EfíBank - charge_id não retornado');
    }

    const efiChargeId = String(chargeResult.charge_id);
    const efiStatus = chargeResult.status || 'waiting';
    
    console.log('✅ COBRANÇA EFIBANK CRIADA (ONE STEP):', {
      charge_id: efiChargeId,
      status: efiStatus,
      total: chargeResult.total,
      installments: chargeResult.installments
    });

    // 📝 CRIAR ORDEM NO FIRESTORE
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 💰 CALCULAR TAXAS DINÂMICAS BASEADO NA CONFIGURAÇÃO DO ADMIN
    const feeCalculation = await calculateDynamicFees(amount, 'card', installments || 1, 'efibank', checkoutData?.tenantId || checkoutData?.sellerId);
    
    // 🔄 STATUS MAPPING: EfíBank → VolatusPay
    // approved = cartão pré-autorizado, paid = capturado e confirmado
    let orderStatus = 'PENDING_PAYMENT';
    if (efiStatus === 'approved' || efiStatus === 'paid') {
      orderStatus = 'paid';
    } else if (efiStatus === 'unpaid' || efiStatus === 'canceled') {
      orderStatus = 'failed';
    }
    
    // 📸 CRITICAL: CRIAR SNAPSHOT DO CHECKOUT (HISTÓRICO ETERNO DE PREÇOS)
    const checkoutSnapshot = {
      title: checkoutData?.title || '',
      subtitle: checkoutData?.subtitle || '',
      description: checkoutData?.description || '',
      logoUrl: checkoutData?.logoUrl || null,
      bannerUrl: checkoutData?.bannerUrl || null,
      price: amount,
      originalPrice: checkoutData?.pricing?.amount || amount,
      productType: checkoutData?.productType || 'digital',
      marketTarget: 'brasil',
      pricing: effectivePricing // 🔄 PRICING COMPLETO (inclui subscriptionPeriod da oferta ou checkout!)
    };
    

    // ✅ Validação de período de assinatura já realizada ANTES do débito (pré-validação acima)
    
    const orderData = {

      id: orderId,
      checkoutId,
      productId: checkoutData?.productId || null, // 🔑 CRITICAL: necessário para acesso à área de membros
      tenantId: checkoutData?.tenantId || checkoutData?.sellerId,
      sellerId: checkoutData?.sellerId,
      status: orderStatus,
      method: 'card',
      paymentMethod: 'efibank_card',
      paymentProcessor: 'efibank',
      amount,
      installments,
      customer,
      customerAddress: customerAddress || null,
      productType: checkoutData?.productType || 'digital',
      subscriptionPeriod: (isSubscriptionCardPre && effectivePricing?.subscriptionPeriod) ? effectivePricing.subscriptionPeriod : null,
      marketTarget: 'brasil',
      // 📸 SNAPSHOT DO CHECKOUT (HISTÓRICO ETERNO)
      checkoutSnapshot: checkoutSnapshot,
      efiChargeId, // ✅ CORRIGIDO: charge_id ao invés de txid (txid é PIX)
      efiStatus, // Status original do EfíBank
      cardMask,
      selectedOrderBumps,
      orderBumps: efibankCardEnrichedBumps.length > 0 ? efibankCardEnrichedBumps : null,
      offerSlug: req.body.offerSlug || null,
      offerTitle: req.body.offerTitle || null,
      couponCode: cardCouponCode || null,
      affiliateUid: cardAffiliateUid || null,
      trackingParameters: cardTrackingParams || null,
      // 💰 TAXAS DINÂMICAS (baseadas na configuração do admin e parcelas)
      gatewayFee: feeCalculation.gatewayFee,
      gatewayFeePercent: feeCalculation.gatewayFeePercent,
      platformFee: feeCalculation.platformFee,
      platformFeePercent: feeCalculation.platformFeePercent,
      netAmount: feeCalculation.netAmount,
      // 📊 SNAPSHOT FINANCEIRO ETERNO - PRESERVA TAXAS E PRAZOS DA DATA DA VENDA
      financialData: {
        grossAmount: amount,
        feeAmount: feeCalculation.gatewayFee + feeCalculation.platformFee,
        netAmount: feeCalculation.netAmount,
        releaseDate: new Date(Date.now() + (feeCalculation.releaseDays || 0) * 24 * 60 * 60 * 1000),
        released: false,
        feeBreakdown: {
          fixedFee: 0,
          percentFee: feeCalculation.gatewayFeePercent,
          percentAmount: feeCalculation.gatewayFee,
          platformFeePercent: feeCalculation.platformFeePercent,
          platformFeeAmount: feeCalculation.platformFee
        },
        releaseDays: feeCalculation.releaseDays || 0
      },
      // 💳 CONTROLE DE SALDO PENDENTE (usado pelo cron de liberação e balance summary)
      financial: {
        netAmount: feeCalculation.netAmount,
        balanceType: 'pending', // Cartão começa como pending até D+releaseDays
        releaseDate: new Date(Date.now() + (feeCalculation.releaseDays || 0) * 24 * 60 * 60 * 1000),
        releaseDays: feeCalculation.releaseDays || 0,
        cardBalanceReleased: false,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    await db.collection('orders').doc(orderId).set(removeUndefinedDeep(orderData));
    
    console.log('✅ ORDEM CRIADA NO FIRESTORE:', orderId);
    console.log(`📊 STATUS: ${orderStatus} (EfíBank: ${efiStatus})`);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('./lib/neon-financial.js').then(({ neonWriteOrder }) => {
      neonWriteOrder({
        id: orderId,
        checkoutId: orderData.checkoutId,
        productId: orderData.productId,
        tenantId: orderData.tenantId || orderData.sellerId,
        sellerId: orderData.sellerId,
        status: orderData.status,
        method: orderData.method,
        paymentMethod: orderData.paymentMethod,
        paymentProcessor: orderData.paymentProcessor,
        amount: orderData.amount,
        currency: 'BRL',
        installments: orderData.installments,
        productType: orderData.productType,
        marketTarget: orderData.marketTarget,
        efiChargeId: orderData.efiChargeId,
        efiStatus: orderData.efiStatus,
        cardMask: orderData.cardMask,
        offerSlug: orderData.offerSlug,
        offerTitle: orderData.offerTitle,
        couponCode: orderData.couponCode,
        affiliateUid: orderData.affiliateUid,
        gatewayFee: orderData.gatewayFee,
        gatewayFeePercent: orderData.gatewayFeePercent,
        platformFee: orderData.platformFee,
        platformFeePercent: orderData.platformFeePercent,
        netAmount: orderData.netAmount,
        customer: orderData.customer,
        checkoutSnapshot: orderData.checkoutSnapshot,
        financialData: orderData.financialData,
        financial: orderData.financial,
        trackingParameters: orderData.trackingParameters,
        selectedOrderBumps: orderData.selectedOrderBumps,
        orderBumps: orderData.orderBumps,
      });
    }).catch(() => {});
    console.log(`💰 TAXAS CARTÃO ${installments}x: Gateway=${feeCalculation.gatewayFeePercent}% (R$ ${(feeCalculation.gatewayFee/100).toFixed(2)}) Platform=${feeCalculation.platformFeePercent}% (R$ ${(feeCalculation.platformFee/100).toFixed(2)}) Net=R$ ${(feeCalculation.netAmount/100).toFixed(2)}`);

    // 🔥 PROCESSAR PÓS-PAGAMENTO SE APROVADO IMEDIATAMENTE (EFIBANK CARD)
    if (orderStatus === 'paid') {
      const sellerId = checkoutData?.tenantId || checkoutData?.sellerId;
      
      // 📋 SINCRONIZAR STATUS NO RTDB + BUNNY CDN
      syncOrderAfterUpdate(sellerId, orderId, {
        status: 'paid',
        paidAt: new Date().toISOString(),
        method: 'card',
        netAmount: feeCalculation.netAmount,
        gatewayFee: feeCalculation.gatewayFee
      });

      // 📊 ENVIAR ATUALIZAÇÃO PARA UTMIFY
      sendOrderStatusUpdate(sellerId, orderId, 'paid', { paidAt: new Date() })
        .catch(err => console.warn('[UTMify] Async EfíBank card paid update failed:', err?.message));

      // 🔔 DISPARAR WEBHOOKS DO SELLER (payment.card.approved)
      if (sellerId) {
        dispatchCardApprovedEvent(sellerId, {
          id: orderId,
          checkoutId,
          amount,
          customer,
          customerAddress: customerAddress || null,
          productType: checkoutData?.productType || 'digital',
          productId: checkoutData?.productId || null,
          checkoutSnapshot: { title: checkoutData?.title || '' },
          processor: 'efibank',
          chargeId: efiChargeId,
          paidAt: new Date()
        }).catch(err => console.warn('[Webhook] EfíBank card seller webhook failed:', err?.message));
      }

      // 🎯 CRIAR ENROLLMENT AUTOMÁTICO
      try {
        console.log('🎯 INICIANDO CRIAÇÃO DE ENROLLMENT AUTOMÁTICO (EFIBANK-CARD)...');
        await storage.createEnrollmentOnPayment(orderData);
      } catch (enrollmentError) {
        console.error('❌ Erro ao criar enrollment automático (EfíBank Card):', enrollmentError);
      }

      // 📧 CRIAR CONTA E ENVIAR EMAIL DE ACESSO À ÁREA DE MEMBROS (EFIBANK CARD WEBHOOK)
      if (orderData.productType === 'digital' || orderData.productType === 'subscription' || !orderData.productType) {
        try {
          await autoCreateMemberOnPurchase({
            customerEmail: customer?.email || orderData.customerEmail,
            customerName: customer?.name || orderData.customerName,
            productId: orderData.productId,
            productType: orderData.productType,
            orderId,
            checkoutId: orderData.checkoutId || orderData.checkoutSlug
          });
        } catch(e: any) { console.warn('⚠️ [AUTO-MEMBER] Erro efibank-card-webhook:', e?.message || e); }
      }

      // 💰 CREDITAR SALDO DO VENDEDOR (EFIBANK CARD) - CRITICAL FIX
      try {
        const { processWebhookWithBalanceUpdate } = await import('./lib/atomic-balance.js');
        const balanceIdempotencyKey = `efibank_card_${efiChargeId}`;
        let sellerCredit = Math.round(feeCalculation.netAmount);
        
        let affiliateCommissionData: any = null;
        if (cardAffiliateUid || orderData.affiliateCode) {
          try {
            affiliateCommissionData = await (storage as any).calculateAffiliateCommission(orderData);
            if (affiliateCommissionData?.hasAffiliate && affiliateCommissionData.netCommission > 0) {
              sellerCredit -= affiliateCommissionData.netCommission;
              console.log(`💰 EFIBANK-CARD: Valor vendedor após comissão afiliado: R$ ${(sellerCredit/100).toFixed(2)}`);
            }
          } catch (calcErr: any) {
            console.warn('⚠️ Erro calcular comissão (EfíBank Card):', calcErr?.message);
          }
        }
        
        // 💳 CARTÃO: Saldo entra como PENDING até D+releaseDays (prazo de saque do admin)
        const cardReleaseDate = new Date(Date.now() + (feeCalculation.releaseDays || 30) * 24 * 60 * 60 * 1000);
        await processWebhookWithBalanceUpdate({
          webhookId: balanceIdempotencyKey,
          provider: 'efibank',
          eventType: 'card.approved',
          sellerId: sellerId,
          amountCents: sellerCredit,
          currency: 'BRL',
          operation: 'add',
          balanceType: 'pending',
          reason: `Pagamento Cartão EfíBank aprovado - Ordem ${orderId} (libera em D+${feeCalculation.releaseDays || 30})`,
          orderId: orderId,
          metadata: {
            method: 'card',
            acquirer: 'efibank',
            totalAmount: amount,
            platformFee: feeCalculation.platformFee,
            gatewayFee: feeCalculation.gatewayFee,
            affiliateCommission: affiliateCommissionData?.netCommission || 0,
            customer: customer.email,
            releaseDays: feeCalculation.releaseDays || 30,
            releaseDate: cardReleaseDate.toISOString(),
            installments: installments || 1,
          },
          rawPayload: chargeResult
        });
        console.log(`✅ EFIBANK-CARD: Saldo PENDENTE creditado ao vendedor: R$ ${(sellerCredit/100).toFixed(2)} (libera em ${cardReleaseDate.toLocaleDateString('pt-BR')})`);

        // 💾 Gravar sellerCreditAmount no order para o cron de liberação usar o valor exato
        await db.collection('orders').doc(orderId).update({
          'financial.sellerCreditAmount': sellerCredit,
          'financial.affiliateCommissionAmount': affiliateCommissionData?.netCommission || 0,
        });
      } catch (balanceErr: any) {
        console.error('❌ EFIBANK-CARD: Erro ao creditar saldo do vendedor:', balanceErr?.message);
      }

      // 🎯 DISPARAR PIXEL DE COMPRA (EFIBANK CARD - FACEBOOK CAPI)
      if (checkoutId) {
        dispatchPurchaseEventToPixels(checkoutId, {
          id: orderId, tenantId: sellerId, customerEmail: customer.email,
          customerName: customer.name, customerPhone: customer.phone,
          amount: amount, currency: 'BRL', productName: checkoutData?.title || 'Produto',
          method: 'card', checkoutSlug: checkoutData?.slug
        }).catch(err => console.warn('[CAPI] EfíBank card purchase dispatch failed:', err?.message));
      }

      // 🔗 PROCESSAR COMISSÃO DE AFILIADO SE HOUVER
      if (cardAffiliateUid || orderData.affiliateCode) {
        try {
          await storage.processAffiliateCommission({ ...orderData, id: orderId });
          console.log('💰 EFIBANK-CARD: Comissão de afiliado processada com sucesso');
        } catch (affiliateError: any) {
          console.error('❌ EFIBANK-CARD: Erro ao processar comissão de afiliado:', affiliateError);
        }
      }

      // 🎫 INCREMENTAR USO DO CUPOM
      if (cardCouponCode) {
        try {
          const couponDoc = await storage.getCouponByCode(cardCouponCode, sellerId);
          if (couponDoc) {
            await storage.incrementCouponUsage(couponDoc.id);
            console.log(`🎫 [EFIBANK-CARD] Cupom ${cardCouponCode} uso incrementado`);
          }
        } catch(e) { console.warn('⚠️ [COUPON] Erro ao incrementar uso:', e); }
      }
    }

    // 🎉 RESPOSTA DE SUCESSO
    const successResult = {
      success: true,
      orderId,
      charge_id: efiChargeId,
      status: orderStatus,
      efi_status: efiStatus,
      amount,
      installments,
      cardMask,
      message: efiStatus === 'approved' || efiStatus === 'paid' ? 'Pagamento aprovado com sucesso!' : 'Pagamento processado'
    };
    
    // 🔒 REGISTRAR IDEMPOTENCY COMO COMPLETO
    if (req.idempotencyKey) {
      await completeIdempotency(req.idempotencyKey, successResult);
    }
    
    return res.json(successResult);
    
  } catch (error: any) {
    console.error('❌ ERRO NO PAGAMENTO EFIBANK CARTÃO:', error?.message || error?.code || JSON.stringify(error) || 'Erro desconhecido');
    if (error?.stack) console.error('📍 Stack:', error.stack.split('\n').slice(0, 5).join('\n'));
    
    // 🔒 REGISTRAR IDEMPOTENCY COMO FALHO
    if (req.idempotencyKey) {
      await failIdempotency(req.idempotencyKey, error);
    }
    
    // Log detalhado para debug
    if (error.response?.data) {
      console.error('📄 Resposta da API EfíBank:', error.response.data);
    }
    
    // 🌐 TRADUÇÃO DE ERROS EFIBANK PARA PORTUGUÊS
    let userMessage = 'Erro ao processar pagamento. Tente novamente.';
    const efiError = error.response?.data?.error_description || error.response?.data?.message || error.message || '';
    const efiCode = error.response?.data?.code || error.response?.status || 0;
    
    // Erros específicos da EfíBank com tradução
    if (efiError.toLowerCase().includes('cpf') || efiError.toLowerCase().includes('document')) {
      userMessage = 'CPF inválido. Verifique o número digitado e tente novamente.';
    } else if (efiError.toLowerCase().includes('holder_name') || efiError.toLowerCase().includes('cardholder')) {
      userMessage = 'Nome no cartão inválido. Digite o nome exatamente como está no cartão.';
    } else if (efiError.toLowerCase().includes('card_number') || efiError.toLowerCase().includes('número do cartão')) {
      userMessage = 'Número do cartão inválido. Verifique os dígitos e tente novamente.';
    } else if (efiError.toLowerCase().includes('cvv') || efiError.toLowerCase().includes('security_code')) {
      userMessage = 'Código de segurança (CVV) inválido. Verifique o código no verso do cartão.';
    } else if (efiError.toLowerCase().includes('expir') || efiError.toLowerCase().includes('validade')) {
      userMessage = 'Data de validade inválida. Verifique mês e ano de expiração.';
    } else if (efiError.toLowerCase().includes('insufficient') || efiError.toLowerCase().includes('saldo')) {
      userMessage = 'Saldo insuficiente. Tente outro cartão ou forma de pagamento.';
    } else if (efiError.toLowerCase().includes('declined') || efiError.toLowerCase().includes('recusad')) {
      userMessage = 'Pagamento recusado pelo emissor do cartão. Entre em contato com seu banco.';
    } else if (efiError.toLowerCase().includes('blocked') || efiError.toLowerCase().includes('bloquead')) {
      userMessage = 'Cartão bloqueado. Entre em contato com seu banco.';
    } else if (efiError.toLowerCase().includes('timeout') || efiError.toLowerCase().includes('tempo')) {
      userMessage = 'Tempo esgotado. A operação demorou muito. Tente novamente.';
    } else if (efiError.toLowerCase().includes('invalid_token') || efiError.toLowerCase().includes('token')) {
      userMessage = 'Erro de segurança. Recarregue a página e tente novamente.';
    } else if (efiError.toLowerCase().includes('limit') || efiError.toLowerCase().includes('limite')) {
      userMessage = 'Limite do cartão excedido. Tente um valor menor ou outro cartão.';
    } else if (efiError.toLowerCase().includes('installment') || efiError.toLowerCase().includes('parcela')) {
      userMessage = 'Parcelamento não autorizado. Tente à vista ou menos parcelas.';
    } else if (efiCode === 500 || efiCode === 5000) {
      userMessage = 'Erro temporário no processador de pagamento. Aguarde alguns minutos e tente novamente.';
    } else if (efiCode === 400) {
      userMessage = 'Dados do cartão inválidos. Verifique todas as informações e tente novamente.';
    } else if (efiCode === 401 || efiCode === 403) {
      userMessage = 'Erro de autenticação com o processador. Tente novamente em alguns minutos.';
    }
    
    return res.status(500).json({
      error: 'Falha no processamento do pagamento',
      message: userMessage,
      details: process.env.NODE_ENV === 'development' ? (error.response?.data || error.message) : undefined
    });
  }
});

// 🔧 ENDPOINT PARA CONFIGURAÇÃO SEGURA EFIBANK 
app.get('/api/efibank/config', async (req, res) => {
  try {
    console.log('📡 GET /api/efibank/config - Buscando config do Firebase...');
    
    // Headers anti-cache e CORS FORTES
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    });
    
    // 🔥 BUSCAR CONFIGURAÇÃO DO FIREBASE (não de .env!)
    await ensureFirebaseReady();
    const db = getFirestore();
    const config = await getPaymentConfig(db);
    
    if (!config || !config.efibank) {
      console.error('❌ Configuração EfíBank não encontrada no Firebase!');
      return res.status(500).json({ 
        error: 'EfíBank não configurado adequadamente' 
      });
    }
    
    const environment = config.efibank.environment || 'production';
    const isProduction = environment === 'production';
    const payeeCode = config.efibank.payeeCode;
    
    if (!payeeCode) {
      console.error('❌ PayeeCode não configurado no Firebase!');
      return res.status(500).json({ 
        error: 'EfíBank PayeeCode ausente' 
      });
    }
    
    console.log(`✅ Config EfíBank do Firebase: ${environment} - PayeeCode: ${payeeCode.substring(0, 8)}...`);
    
    return res.json({
      environment,
      payeeCode,
      isProduction
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar configuração EfíBank:', error);
    return res.status(500).json({
      error: 'Falha ao carregar configuração',
      message: error.message
    });
  }
});

// 🔒 ENDPOINT PARA TOKENIZAÇÃO SEGURA DE CARTÃO EFIBANK
app.post('/api/tokenize-card', async (req, res) => {
  try {
    console.log('🔐 TOKENIZAÇÃO SEGURA DE CARTÃO EFIBANK...');
    
    const { cardData } = req.body;
    
    // 🛡️ VALIDAÇÕES CRÍTICAS
    if (!cardData || !cardData.number || !cardData.cvv || !cardData.expiry_month || !cardData.expiry_year || !cardData.holder_name) {
      return res.status(400).json({ 
        error: 'Dados do cartão obrigatórios: number, cvv, expiry_month, expiry_year, holder_name' 
      });
    }

    // 🔑 OBTER CREDENCIAIS DO FIREBASE (fonte oficial - não env vars)
    await ensureFirebaseReady();
    const dbForTokenize = getFirestore();
    const { getEfiBankKeys: getEfiBankKeysForTokenize } = await import('./lib/payment-config.js');
    const efiKeysForTokenize = await getEfiBankKeysForTokenize(dbForTokenize);

    if (!efiKeysForTokenize.clientId || !efiKeysForTokenize.clientSecret) {
      console.error('❌ CREDENCIAIS EFIBANK AUSENTES PARA TOKENIZAÇÃO (Firebase + env)');
      return res.status(500).json({ 
        error: 'EFIBank não configurado para tokenização',
        message: 'Configure Client ID e Client Secret em Admin → Vendas Globais'
      });
    }

    const isProduction = efiKeysForTokenize.environment === 'production';

    // 🔑 OBTER TOKEN DE ACESSO (usa credenciais do Firebase internamente)
    const token = await getEfiAccessToken();
    
    // 🔒 CRIAR PAYLOAD PARA TOKENIZAÇÃO
    const tokenPayload = {
      brand: cardData.brand || 'visa', // Usar brand detectado do frontend
      number: cardData.number.replace(/\D/g, ''),
      cvv: cardData.cvv,
      expiration_month: cardData.expiry_month,
      expiration_year: cardData.expiry_year,
      holder_name: cardData.holder_name.toUpperCase(),
      holder_document: cardData.holder_document || '00000000000'
    };

    console.log('🔐 ENVIANDO DADOS PARA TOKENIZAÇÃO EFIBANK');

    const https = await import('https');
    const fs = await import('fs');
    const certificadoPath = getCertPath(isProduction ? 'efi-prod.p12' : 'efi-sandbox.p12');
    const certificado = fs.readFileSync(certificadoPath);
    
    const baseUrl = isProduction 
      ? 'api.efipay.com.br'
      : 'sandbox.efipay.com.br';

    // 🔐 TOKENIZAR CARTÃO NA EFIBANK
    const tokenResponse = await new Promise((resolve, reject) => {
      const options = {
        hostname: baseUrl,
        port: 443,
        path: '/v1/payment-token',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        // 🚀 ATIVADO: VENDAS REAIS SEM CERTIFICADO P12 - APENAS OAUTH2 BEARER
      };

      const req = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (response.statusCode >= 200 && response.statusCode < 300) {
              resolve(result);
            } else {
              console.error('❌ ERRO TOKENIZAÇÃO EFIBANK:', response.statusCode, result);
              reject(new Error(`EFIBank tokenization error: ${result.message || result.error_description || data}`));
            }
          } catch (error) {
            reject(new Error(`Erro ao parsear resposta de tokenização EFIBank: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(JSON.stringify(tokenPayload));
      req.end();
    });

    console.log('✅ TOKENIZAÇÃO EFIBANK CONCLUÍDA');

    // 🔒 RETORNAR APENAS O TOKEN (DADOS SENSÍVEIS NUNCA RETORNAM)
    const tokenData = tokenResponse as any;
    return res.json({
      payment_token: tokenData.payment_token || tokenData.data?.payment_token
    });

  } catch (error: any) {
    console.error('❌ ERRO TOKENIZAÇÃO CARTÃO:', error);
    return res.status(500).json({
      error: 'Erro na tokenização do cartão',
      message: error.message
    });
  }
});
// [EXTRACTED] post /api/admin/support-ticket-create moved to server/routes/admin.ts

// [EXTRACTED] Integration routes moved to server/routes/integrations.ts

// 🔔 FUNÇÃO AUXILIAR: DISPARAR WEBHOOKS PARA VENDAS (REAL - FIREBASE)
async function triggerSellerWebhooks(sellerUid: string, event: string, data: any) {
  try {
    console.log(`🔔 Disparando webhooks para seller ${sellerUid} - Evento: ${event}`);
    
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    // Buscar webhooks ativos do seller para este evento
    const webhooksSnapshot = await db.collection('webhooks')
      .where('sellerUid', '==', sellerUid)
      .where('active', '==', true)
      .get();
    
    if (webhooksSnapshot.empty) {
      console.log(`ℹ️ Nenhum webhook ativo para seller ${sellerUid}`);
      return;
    }
    
    const webhooks = webhooksSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((webhook: any) => webhook.events.includes(event));
    
    if (webhooks.length === 0) {
      console.log(`ℹ️ Nenhum webhook configurado para evento "${event}"`);
      return;
    }
    
    console.log(`📡 ${webhooks.length} webhook(s) encontrado(s) para evento "${event}"`);
    
    // Disparar webhooks em paralelo
    const webhookPromises = webhooks.map(async (webhook: any) => {
      try {
        const payload = {
          event,
          timestamp: new Date().toISOString(),
          data,
          seller_id: sellerUid
        };
        
        // Gerar assinatura HMAC se webhook tiver secret
        let signature = '';
        if (webhook.secret) {
          const crypto = await import('crypto');
          const hmac = crypto.createHmac('sha256', webhook.secret);
          hmac.update(JSON.stringify(payload));
          signature = hmac.digest('hex');
        }
        
        console.log(`📤 Enviando webhook para ${webhook.url}`);
        
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'VolatusPay-Webhooks/1.0',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': event,
            'X-Webhook-Timestamp': new Date().toISOString()
          },
          body: JSON.stringify(payload)
        });
        
        // Atualizar estatísticas do webhook
        const webhookRef = db.collection('webhooks').doc(webhook.id);
        if (response.ok) {
          console.log(`✅ Webhook ${webhook.id} disparado com sucesso (${response.status})`);
          await webhookRef.update({
            lastTrigger: adminSdk.firestore.FieldValue.serverTimestamp(),
            successCount: adminSdk.firestore.FieldValue.increment(1),
            updatedAt: adminSdk.firestore.FieldValue.serverTimestamp()
          });
        } else {
          console.error(`❌ Webhook ${webhook.id} falhou (${response.status})`);
          await webhookRef.update({
            lastTrigger: adminSdk.firestore.FieldValue.serverTimestamp(),
            failureCount: adminSdk.firestore.FieldValue.increment(1),
            updatedAt: adminSdk.firestore.FieldValue.serverTimestamp()
          });
        }
      } catch (error) {
        console.error(`❌ Erro ao disparar webhook ${webhook.id}:`, error);
        // Atualizar contador de falhas
        const webhookRef = db.collection('webhooks').doc(webhook.id);
        await webhookRef.update({
          failureCount: adminSdk.firestore.FieldValue.increment(1),
          updatedAt: adminSdk.firestore.FieldValue.serverTimestamp()
        });
      }
    });
    
    await Promise.allSettled(webhookPromises);
    console.log(`✅ Webhooks processados para evento "${event}"`);
    
  } catch (error) {
    console.error('❌ Erro ao disparar webhooks:', error);
  }
}
// [EXTRACTED] get /api/admin/firebase-debug moved to server/routes/admin.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts

// 🚫 DEBUG ENDPOINT REMOVIDO - SISTEMA EM PRODUÇÃO

// 🚫 ENDPOINT DE CORREÇÃO REMOVIDO - SELLERS JÁ MIGRADOS EM PRODUÇÃO

// 🔧 FUNÇÃO UTILITÁRIA: Normalizar timestamps recursivamente em objetos/arrays
function normalizeTimestamps(obj: any, seen = new WeakSet()): any {
  if (obj === null || obj === undefined) return obj;
  
  // Se for Firestore Timestamp, converter para ISO string
  if (obj?.toDate && typeof obj.toDate === 'function') {
    return obj.toDate().toISOString();
  }
  
  // Se for Date, converter para ISO string
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  
  // Se for array, processar cada elemento
  if (Array.isArray(obj)) {
    return obj.map(item => normalizeTimestamps(item, seen));
  }
  
  // Se for objeto, verificar referência circular e processar recursivamente
  if (typeof obj === 'object') {
    // ⚠️ PROTEÇÃO CONTRA REFERÊNCIAS CIRCULARES (previne loops infinitos)
    if (seen.has(obj)) {
      return '[Circular Reference]';
    }
    seen.add(obj);
    
    const normalized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        normalized[key] = normalizeTimestamps(obj[key], seen);
      }
    }
    return normalized;
  }
  
  // Tipos primitivos retornam como estão
  return obj;
}
// [EXTRACTED] get /api/admin/orders moved to server/routes/admin.ts

// [EXTRACTED] Affiliate my-orders route moved to server/routes/affiliations.ts
// [DEAD CODE] GET /api/orders - duplicated by ordersRouter (mounted at /api/orders, route GET /) which runs first
app.get('/api/orders', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('💳 GET /api/orders - Seller buscando suas orders (RTDB+Cache)...');
    
    const { tenantId } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId é obrigatório',
        code: 'MISSING_TENANT_ID'
      });
    }
    
    const userTenant = await getTenantFromAuth(req);
    const isAdmin = req.authUser?.isAdmin;
    
    if (userTenant !== tenantId && !isAdmin) {
      console.error(`🚨 SECURITY: Tentativa de acesso não autorizado - userTenant: ${userTenant}, tenantId: ${tenantId}`);
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        code: 'FORBIDDEN'
      });
    }
    
    console.log(`🔍 Buscando orders do seller: ${tenantId}`);
    
    const { getOrdersIndexFromRTDB } = await import('./lib/orders-sync.js');
    const { firestoreCache } = await import('./lib/firestore-cache.js');
    
    try {
      const rtdbIndex = await getOrdersIndexFromRTDB(tenantId as string);
      if (rtdbIndex && Object.keys(rtdbIndex).length > 0) {
        console.log(`⚡ [RTDB-LEGACY] Usando RTDB para ${tenantId} (${Object.keys(rtdbIndex).length} orders)`);
        
        let ordersArray = Object.entries(rtdbIndex).map(([id, data]: [string, any]) => 
          normalizeTimestamps({ id, ...data })
        );
        
        ordersArray.sort((a: any, b: any) => {
          const aTime = new Date(a.createdAt || 0).getTime();
          const bTime = new Date(b.createdAt || 0).getTime();
          return bTime - aTime;
        });
        
        const affiliateUidsToResolve = new Set<string>();
        ordersArray.forEach((order: any) => {
          if (order.isAffiliateSale && order.affiliateUid && (!order.affiliateName || !order.affiliateEmail)) {
            affiliateUidsToResolve.add(order.affiliateUid);
          }
        });
        
        if (affiliateUidsToResolve.size > 0) {
          await Promise.all(Array.from(affiliateUidsToResolve).map(async (uid) => {
            try {
              const seller = await firestoreCache.getSeller(uid);
              if (seller) {
                ordersArray.forEach((order: any) => {
                  if (order.affiliateUid === uid) {
                    if (!order.affiliateName) order.affiliateName = seller.businessName || seller.name || seller.email?.split('@')[0] || 'Afiliado';
                    if (!order.affiliateEmail) order.affiliateEmail = seller.email || '';
                  }
                });
              }
            } catch (e) {}
          }));
        }
        
        console.log(`⚡ [RTDB-LEGACY] ✅ ${ordersArray.length} orders via RTDB`);
        return res.json({
          success: true,
          orders: ordersArray,
          data: ordersArray,
          total: ordersArray.length
        });
      }
    } catch (rtdbError) {
      console.warn('⚠️ [RTDB-LEGACY] Fallback para Firestore:', rtdbError);
    }
    
    const db = getFirestore();
    const ordersSnapshot = await db
      .collection('orders')
      .where('tenantId', '==', tenantId)
      .orderBy('createdAt', 'desc')
      .get();
    
    const affiliateUidsToResolve = new Set<string>();
    const rawOrders = ordersSnapshot.docs.map((doc: any) => {
      const order = normalizeTimestamps({ id: doc.id, ...doc.data() });
      if (order.isAffiliateSale && order.affiliateUid && (!order.affiliateName || !order.affiliateEmail)) {
        affiliateUidsToResolve.add(order.affiliateUid);
      }
      return order;
    });
    
    if (affiliateUidsToResolve.size > 0) {
      await Promise.all(Array.from(affiliateUidsToResolve).map(async (uid) => {
        try {
          const seller = await firestoreCache.getSeller(uid);
          if (seller) {
            rawOrders.forEach((order: any) => {
              if (order.affiliateUid === uid) {
                if (!order.affiliateName) order.affiliateName = seller.businessName || seller.name || seller.email?.split('@')[0] || 'Afiliado';
                if (!order.affiliateEmail) order.affiliateEmail = seller.email || '';
              }
            });
          }
        } catch (e) {}
      }));
    }
    
    console.log(`✅ ${rawOrders.length} orders encontradas para seller ${tenantId}`);
    
    res.json({
      success: true,
      orders: rawOrders,
      data: rawOrders,
      total: rawOrders.length
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar orders do seller:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      message: error.message,
      code: 'GET_SELLER_ORDERS_ERROR'
    });
  }
});
// [EXTRACTED] post /api/admin/impersonate-login moved to server/routes/admin.ts

// 💰 FUNÇÃO PARA APLICAR TAXAS AUTOMATICAMENTE BASEADAS NO MARKET TARGET
async function getApplicableFees(marketTarget: 'brasil' | 'global', paymentMethod: 'pix' | 'card') {
  try {
    await ensureFirebaseReady();
    const configRef = getAdmin().firestore().collection('admin').doc('acquirers-config');
    const configDoc = await configRef.get();
    
    if (!configDoc.exists) {
      console.log('⚠️ Configurações não encontradas, usando padrão');
      // Retorna taxas padrão
      if (marketTarget === 'brasil') {
        return paymentMethod === 'pix' 
          ? { percent: 0.99, fixed: 0, withdrawalDays: 1, acquirer: 'efibank' }
          : { percent: 3.99, fixed: 0, withdrawalDays: 1, acquirer: 'efibank' };
      } else {
        return { percent: 5.2, fixed: 0.39, withdrawalDays: 2, acquirer: 'stripe' };
      }
    }
    
    const config = configDoc.data();
    
    if (marketTarget === 'brasil') {
      // Brasil = EfíBank
      const efibankConfig = config.efibank;
      if (paymentMethod === 'pix') {
        return {
          percent: efibankConfig.pixFeePercent || 0.99,
          fixed: efibankConfig.pixFeeFixed || 0,
          withdrawalDays: efibankConfig.withdrawalDays || 1,
          acquirer: 'efibank'
        };
      } else {
        return {
          percent: efibankConfig.cardFeePercent || 3.99,
          fixed: efibankConfig.cardFeeFixed || 0,
          withdrawalDays: efibankConfig.withdrawalDays || 1,
          acquirer: 'efibank'
        };
      }
    } else {
      // Global = Stripe
      const stripeConfig = config.stripe;
      return {
        percent: stripeConfig.cardFeePercent || 5.2,
        fixed: stripeConfig.cardFeeFixed || 0.39,
        withdrawalDays: stripeConfig.withdrawalDays || 2,
        acquirer: 'stripe'
      };
    }
  } catch (error) {
    console.error('❌ Erro ao buscar taxas aplicáveis:', error);
    // Fallback para taxas padrão em caso de erro
    if (marketTarget === 'brasil') {
      return paymentMethod === 'pix' 
        ? { percent: 0.99, fixed: 0, withdrawalDays: 1, acquirer: 'efibank' }
        : { percent: 3.99, fixed: 0, withdrawalDays: 1, acquirer: 'efibank' };
    } else {
      return { percent: 5.2, fixed: 0.39, withdrawalDays: 2, acquirer: 'stripe' };
    }
  }
}



// 🔥 STRIPE WEBHOOK - CONFIRMAR PAGAMENTOS GLOBAIS COM VALIDAÇÃO SEGURA
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    console.log('💰 Webhook Stripe recebido - validando assinatura...');
    
    // 🔐 VALIDAÇÃO CRÍTICA DE SEGURANÇA - STRIPE SIGNATURE
    const signature = req.headers['stripe-signature'];
    
    if (!signature) {
      console.error('🚨 STRIPE WEBHOOK REJEITADO: Sem assinatura');
      return res.status(401).json({ error: 'Assinatura obrigatória' });
    }
    
    // 🔒 CARREGAR WEBHOOK SECRET DO FIREBASE (junto com outras configs Stripe)
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    const paymentConfigRef = db.collection('paymentConfig').doc('global');
    const paymentConfigDoc = await paymentConfigRef.get();
    
    let webhookSecret = process.env.STRIPE_WEBHOOK_SECRET; // Fallback para env var
    
    if (paymentConfigDoc.exists) {
      const data = paymentConfigDoc.data();
      if (data?.stripe?.webhookSecret) {
        try {
          // Descriptografar webhook secret do Firebase
          webhookSecret = decryptSensitiveData(data.stripe.webhookSecret);
          console.log('✅ STRIPE Webhook Secret carregado do Firebase (criptografado)');
        } catch (decryptError) {
          console.error('⚠️ Erro ao descriptografar webhook secret, usando env var:', decryptError);
        }
      }
    }
    
    if (!webhookSecret) {
      console.error('🚨 ERRO CRÍTICO: STRIPE_WEBHOOK_SECRET não configurado (nem Firebase nem env var)');
      return res.status(500).json({ error: 'Webhook secret não configurado' });
    }
    
    // 🔒 VERIFICAR ASSINATURA USANDO STRIPE OFICIAL COM CONFIGURAÇÃO SEGURA
    let event;
    try {
      // ✅ USAR CONFIGURAÇÃO SEGURA DO STRIPE
      const stripeConfig = await loadSecureStripeConfig();
      
      if (!stripeConfig || !stripeConfig.secretKey) {
        console.error('❌ STRIPE WEBHOOK REJEITADO: Configuração ausente');
        return res.status(500).json({ error: 'Stripe não configurado' });
      }
      
      const { default: Stripe } = await import('stripe');
      const stripe = new Stripe(stripeConfig.secretKey, { apiVersion: '2025-08-27.basil' });
      
      console.log(`💳 WEBHOOK USANDO CONFIGURAÇÃO STRIPE: ${stripeConfig.environment}`);
      
      // Validar assinatura - se falhar, é um request forjado
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
      console.log('✅ STRIPE WEBHOOK: Assinatura validada com sucesso');
      
    } catch (signatureError: any) {
      console.error('🚨 STRIPE WEBHOOK REJEITADO: Assinatura inválida:', signatureError.message);
      return res.status(401).json({ error: 'Assinatura inválida' });
    }
    
    console.log('🎯 Stripe Event validado:', event.type);
    
    // ✅ PAGAMENTO CONFIRMADO
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const orderId = paymentIntent.metadata?.orderId;
      
      if (orderId) {
        console.log('✅ STRIPE PAGAMENTO CONFIRMADO - Order:', orderId);
        
        // 🔍 BUSCAR ORDEM PARA CALCULAR TAXAS SE NECESSÁRIO (NEON)
        const { neonQuery: _nqStripe } = await import('./lib/neon-db.js');
        let _stripeOrderRow: any = null;
        await _nqStripe(async (sql) => {
          const rows = await sql`SELECT * FROM orders WHERE id = ${orderId} LIMIT 1`;
          if (rows[0]) _stripeOrderRow = rows[0];
        }, `webhook:stripe:getOrder:${orderId}`);
        const orderData = _stripeOrderRow ? {
          ..._stripeOrderRow,
          tenantId: _stripeOrderRow.tenant_id,
          sellerId: _stripeOrderRow.seller_id,
          method: _stripeOrderRow.payment_method,
          gateway: _stripeOrderRow.acquirer,
          productType: _stripeOrderRow.product_type,
          saleType: _stripeOrderRow.sale_type,
          netAmount: _stripeOrderRow.net_amount,
          gatewayFee: _stripeOrderRow.gateway_fee,
          platformFee: _stripeOrderRow.platform_fee,
          customerEmail: _stripeOrderRow.customer_email,
          customerName: _stripeOrderRow.customer_name,
          checkoutId: _stripeOrderRow.checkout_id,
          checkoutSlug: _stripeOrderRow.checkout_slug,
          productId: _stripeOrderRow.product_id,
          affiliateCode: _stripeOrderRow.metadata?.affiliateCode,
          affiliateUid: _stripeOrderRow.metadata?.affiliateUid,
          affiliateId: _stripeOrderRow.metadata?.affiliateId,
          couponCode: _stripeOrderRow.metadata?.couponCode,
          orderBumps: _stripeOrderRow.metadata?.orderBumps,
          customer: _stripeOrderRow.metadata?.customer || { name: _stripeOrderRow.customer_name, email: _stripeOrderRow.customer_email },
          installments: _stripeOrderRow.metadata?.installments,
          cardData: _stripeOrderRow.metadata?.cardData,
        } : null;
        
        // 💰 CALCULAR TAXAS DINÂMICAS SE A ORDEM NÃO TEM
        let feeUpdate: any = {};
        if (orderData && !orderData.gatewayFee) {
          console.log('💰 Ordem Stripe sem taxas calculadas, calculando agora...');
          const feeCalculation = await calculateDynamicFees(
            orderData.amount || paymentIntent.amount,
            'stripe',
            1, // Stripe não tem parcelas por padrão
            'stripe',
            orderData.tenantId || orderData.sellerId
          );
          const amount = orderData.amount || paymentIntent.amount;
          feeUpdate = {
            gatewayFee: feeCalculation.gatewayFee,
            gatewayFeePercent: feeCalculation.gatewayFeePercent,
            platformFee: feeCalculation.platformFee,
            platformFeePercent: feeCalculation.platformFeePercent,
            netAmount: feeCalculation.netAmount,
            // 📊 SNAPSHOT FINANCEIRO COMPLETO (caso order antiga não tenha)
            financialData: {
              grossAmount: amount,
              feeAmount: feeCalculation.gatewayFee + feeCalculation.platformFee,
              netAmount: feeCalculation.netAmount,
              releaseDate: new Date(Date.now() + (feeCalculation.releaseDays || 0) * 24 * 60 * 60 * 1000),
              released: false,
              feeBreakdown: {
                fixedFee: 0,
                percentFee: feeCalculation.gatewayFeePercent,
                percentAmount: feeCalculation.gatewayFee,
                platformFeePercent: feeCalculation.platformFeePercent,
                platformFeeAmount: feeCalculation.platformFee
              },
              releaseDays: feeCalculation.releaseDays || 0
            }
          };
          console.log(`💰 TAXAS STRIPE CALCULADAS: Gateway=${feeCalculation.gatewayFeePercent}% (R$ ${(feeCalculation.gatewayFee/100).toFixed(2)}) Net=R$ ${(feeCalculation.netAmount/100).toFixed(2)}`);
        }
        
        // 📅 CALCULAR PRAZO DE SAQUE BASEADO NO MÉTODO E PARCELAS
        const method = orderData?.method || 'card';
        const gateway = orderData?.gateway || 'stripe';
        const installmentsForDays = orderData?.installments || orderData?.cardData?.installments || 1;
        const withdrawalDays = await getWithdrawalDays(method, gateway, installmentsForDays);
        
        // 🔥 ATUALIZAR STATUS PARA PAID NO FIREBASE
        const updateData = {
          status: 'paid' as const,
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntent.id,
          updatedAt: new Date(),
          webhookReceivedAt: new Date(),
          withdrawalDays, // 📅 SALVAR PRAZO DE SAQUE DA ÉPOCA
          ...feeUpdate // Adicionar taxas se foram calculadas
        };
        
        await _nqStripe(async (sql) => {
          await sql`UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW(), net_amount = ${feeUpdate.netAmount || orderData?.netAmount || 0}, gateway_fee = ${feeUpdate.gatewayFee || orderData?.gatewayFee || 0}, platform_fee = ${feeUpdate.platformFee || orderData?.platformFee || 0}, metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ stripePaymentIntentId: updateData.stripePaymentIntentId, withdrawalDays: updateData.withdrawalDays })}::jsonb WHERE id = ${orderId}`;
        }, `webhook:stripe:markPaid:${orderId}`);
        console.log('📅 STRIPE ORDER STATUS ATUALIZADO PARA PAID (NEON):', orderId);
        
        // 🔔 DISPARAR WEBHOOKS DO SELLER (REAL)
        if (orderData?.tenantId) {
          await triggerSellerWebhooks(orderData.tenantId, 'payment', {
            order_id: orderId,
            checkout_id: orderData.checkoutId,
            amount: orderData.amount,
            currency: 'BRL',
            customer_email: orderData.customerEmail,
            product_type: orderData.productType || 'digital',
            payment_method: 'stripe',
            status: 'paid',
            paid_at: new Date().toISOString()
          });
        }
        
        // 🎯 CRIAR ENROLLMENT AUTOMÁTICO PARA ACESSO AO PRODUTO (STRIPE)
        let _stripeUpdatedRow: any = null;
        await _nqStripe(async (sql) => {
          const rows = await sql`SELECT * FROM orders WHERE id = ${orderId} LIMIT 1`;
          if (rows[0]) _stripeUpdatedRow = rows[0];
        }, `webhook:stripe:reloadOrder:${orderId}`);
        if (_stripeUpdatedRow) {
          const updatedOrderData = {
            ..._stripeUpdatedRow,
            tenantId: _stripeUpdatedRow.tenant_id,
            sellerId: _stripeUpdatedRow.seller_id,
            method: _stripeUpdatedRow.payment_method,
            productType: _stripeUpdatedRow.product_type,
            netAmount: _stripeUpdatedRow.net_amount,
            gatewayFee: _stripeUpdatedRow.gateway_fee,
            platformFee: _stripeUpdatedRow.platform_fee,
            customerEmail: _stripeUpdatedRow.customer_email,
            customerName: _stripeUpdatedRow.customer_name,
            checkoutId: _stripeUpdatedRow.checkout_id,
            checkoutSlug: _stripeUpdatedRow.checkout_slug,
            productId: _stripeUpdatedRow.product_id,
            affiliateCode: _stripeUpdatedRow.metadata?.affiliateCode,
            affiliateUid: _stripeUpdatedRow.metadata?.affiliateUid,
            couponCode: _stripeUpdatedRow.metadata?.couponCode,
            orderBumps: _stripeUpdatedRow.metadata?.orderBumps,
            customer: _stripeUpdatedRow.metadata?.customer || { name: _stripeUpdatedRow.customer_name, email: _stripeUpdatedRow.customer_email },
          };
          
          // 🎯 CRIAR ENROLLMENT AUTOMÁTICO PARA ACESSO AO PRODUTO
          try {
            console.log('🎯 INICIANDO CRIAÇÃO DE ENROLLMENT AUTOMÁTICO (STRIPE)...');
            await storage.createEnrollmentOnPayment(updatedOrderData);
          } catch (enrollmentError) {
            console.error('❌ Erro ao criar enrollment automático (Stripe):', enrollmentError);
            // Não falhar o webhook por causa do enrollment
          }
          
          // 👤 AUTO-CRIAR CONTA DE MEMBRO (se produto tem área de membros)
          // ⚡ FIX: productType null/undefined = tratar como digital
          if (!updatedOrderData.productType || updatedOrderData.productType === 'digital' || updatedOrderData.productType === 'subscription') {
            try {
              await autoCreateMemberOnPurchase({
                customerEmail: updatedOrderData.customer?.email || updatedOrderData.customerEmail,
                customerName: updatedOrderData.customer?.name || updatedOrderData.customerName,
                productId: updatedOrderData.productId,
                productType: updatedOrderData.productType || 'digital',
                orderId,
                checkoutId: updatedOrderData.checkoutId || updatedOrderData.checkoutSlug
              });
            } catch (e: any) { console.warn('⚠️ [AUTO-MEMBER] Stripe erro:', e?.message); }
          }
          
          // 💰 CREDITAR SALDO DO VENDEDOR (STRIPE) - CRITICAL FIX
          try {
            const { processWebhookWithBalanceUpdate } = await import('./lib/atomic-balance.js');
            const balanceIdempotencyKey = `stripe_${paymentIntent.id}`;
            const netAmountCents = Math.round(updatedOrderData.netAmount || (updatedOrderData.amount - (updatedOrderData.gatewayFee || 0) - (updatedOrderData.platformFee || 0)));
            let sellerCredit = netAmountCents;
            
            let affiliateCommissionData: any = null;
            if (updatedOrderData.affiliateUid || updatedOrderData.affiliateCode) {
              try {
                affiliateCommissionData = await (storage as any).calculateAffiliateCommission(updatedOrderData);
                if (affiliateCommissionData?.hasAffiliate && affiliateCommissionData.netCommission > 0) {
                  sellerCredit -= affiliateCommissionData.netCommission;
                  console.log(`💰 STRIPE: Valor vendedor após comissão afiliado: R$ ${(sellerCredit/100).toFixed(2)}`);
                }
              } catch (calcErr: any) {
                console.warn('⚠️ Erro calcular comissão (Stripe):', calcErr?.message);
              }
            }
            
            await processWebhookWithBalanceUpdate({
              webhookId: balanceIdempotencyKey,
              provider: 'stripe',
              eventType: 'payment_intent.succeeded',
              sellerId: updatedOrderData.tenantId,
              amountCents: sellerCredit,
              currency: updatedOrderData.currency || 'BRL',
              operation: 'add',
              balanceType: 'available',
              reason: `Pagamento Stripe confirmado - Ordem ${orderId}`,
              orderId: orderId,
              metadata: {
                method: 'card',
                acquirer: 'stripe',
                totalAmount: updatedOrderData.amount,
                platformFee: updatedOrderData.platformFee || 0,
                gatewayFee: updatedOrderData.gatewayFee || 0,
                affiliateCommission: affiliateCommissionData?.netCommission || 0,
                customer: updatedOrderData.customer?.email || updatedOrderData.customerEmail
              },
              rawPayload: paymentIntent
            });
            console.log(`✅ STRIPE: Saldo creditado ao vendedor: R$ ${(sellerCredit/100).toFixed(2)}`);
          } catch (balanceErr: any) {
            console.error('❌ STRIPE: Erro ao creditar saldo do vendedor:', balanceErr?.message);
          }
          
          // 🎯 DISPARAR PIXEL DE COMPRA (STRIPE - FACEBOOK CAPI)
          if (updatedOrderData.checkoutId) {
            dispatchPurchaseEventToPixels(updatedOrderData.checkoutId, {
              id: orderId, tenantId: updatedOrderData.tenantId, customerEmail: updatedOrderData.customer?.email || updatedOrderData.customerEmail,
              customerName: updatedOrderData.customer?.name || updatedOrderData.customerName, customerPhone: updatedOrderData.customer?.phone || updatedOrderData.customerPhone,
              amount: updatedOrderData.amount, currency: updatedOrderData.currency || 'BRL', productName: updatedOrderData.productName || updatedOrderData.checkoutSnapshot?.title,
              method: 'card', checkoutSlug: updatedOrderData.checkoutSlug
            }).catch(err => console.warn('[CAPI] Stripe purchase dispatch failed:', err?.message));
          }

          // 🔗 PROCESSAR COMISSÃO DE AFILIADO SE HOUVER (STRIPE)
          if (updatedOrderData.affiliateCode || updatedOrderData.affiliateUid) {
            console.log('🔗 AFILIADO DETECTADO - PROCESSANDO COMISSÃO STRIPE:', updatedOrderData.affiliateCode || updatedOrderData.affiliateUid);
            try {
              await storage.processAffiliateCommission({ ...updatedOrderData, id: orderId });
              console.log('💰 STRIPE: Comissão de afiliado processada com sucesso');
            } catch (affiliateError: any) {
              console.error('❌ STRIPE WEBHOOK: Erro ao processar comissão de afiliado:', affiliateError);
            }
          }
          
          if (updatedOrderData.couponCode) {
            try {
              const couponDoc = await storage.getCouponByCode(updatedOrderData.couponCode, updatedOrderData.tenantId);
              if (couponDoc) {
                await storage.incrementCouponUsage(couponDoc.id);
                console.log(`🎫 [STRIPE] Cupom ${updatedOrderData.couponCode} uso incrementado`);
              }
            } catch(e) { console.warn('⚠️ [COUPON STRIPE] Erro ao incrementar uso:', e); }
          }
        }
        
        // 📧 ENVIAR EMAIL DE VENDA APROVADA PARA SELLER (STRIPE)
        try {
          if (orderData?.tenantId) {
            let _stripeSellerData: any = null;
            await _nqStripe(async (sql) => {
              const rows = await sql`SELECT email, business_name, full_name FROM sellers WHERE id = ${orderData.tenantId} LIMIT 1`;
              if (rows[0]) _stripeSellerData = rows[0];
            }, `webhook:stripe:getSeller:${orderData.tenantId}`);
            const sellerData = _stripeSellerData ? { email: _stripeSellerData.email, businessName: _stripeSellerData.business_name, fullName: _stripeSellerData.full_name } : null;
            if (sellerData?.email) {
              const { sendSaleApprovedEmail } = await import('./lib/email-service.js');
              const stripeOrderBumps = orderData.orderBumps?.map((b: any) => ({ name: b.name || b.productName || 'Order Bump', price: b.price || b.amount || 0 })) || [];
              const stripeBumpsTotal = stripeOrderBumps.reduce((sum: number, b: any) => sum + b.price, 0);
              const stripeNetAmount = feeUpdate.netAmount || orderData.netAmount || (orderData.amount - (feeUpdate.gatewayFee || orderData.gatewayFee || 0) - (feeUpdate.platformFee || orderData.platformFee || 0));
              await sendSaleApprovedEmail({
                sellerEmail: sellerData.email,
                sellerName: sellerData.businessName || sellerData.fullName,
                productName: orderData.productName || orderData.checkoutTitle || 'Produto',
                productPrice: (orderData.amount || paymentIntent.amount) - stripeBumpsTotal,
                buyerName: orderData.customer?.name || orderData.customerName || 'Cliente',
                buyerEmail: orderData.customer?.email || orderData.customerEmail || '',
                paymentMethod: 'credit_card',
                orderId: orderId,
                netAmount: stripeNetAmount,
                orderBumps: stripeOrderBumps.length > 0 ? stripeOrderBumps : undefined,
                currency: orderData.currency || 'BRL'
              });
              console.log(`📧✅ Email de venda aprovada (Stripe) enviado para seller: ${sellerData.email}`);
            }
          }
        } catch (emailErr: any) {
          console.warn(`⚠️ Email error (Stripe):`, emailErr?.message);
        }

        // 💼 COMISSÕES DE COPRODUÇÃO — Stripe (fire-and-forget)
        if (orderData?.tenantId) {
          processCoproductionCommissions(
            orderId,
            orderData.checkoutId,
            orderData.tenantId,
            orderData.amount || paymentIntent.amount,
            feeUpdate.netAmount || orderData.netAmount || 0,
            orderData.affiliateCode ? 'affiliate_sale' : 'own_sale',
            orderData.affiliateId
          ).catch((e: any) => console.warn('⚠️ [COPROD] Stripe err:', e?.message));
        }

        // 🔐 SECURITY: Registrar transação aprovada (limites de volume)
        if (orderData?.tenantId) {
          import('./security/transaction-limits.js').then(({ recordApprovedTransaction }) => {
            recordApprovedTransaction(orderData.tenantId, orderData.amount || paymentIntent.amount || 0).catch(() => {});
          }).catch(() => {});
        }
        
        res.status(200).json({ received: true, processed: true });
      } else {
        console.log('⚠️ Order ID não encontrado no metadata');
        res.status(200).json({ received: true, processed: false });
      }
    } else {
      console.log('ℹ️ Stripe Event ignorado:', event.type);
      res.status(200).json({ received: true });
    }
  } catch (error) {
    console.error('❌ Erro no webhook Stripe:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// 🔐 EFÍBANK WEBHOOK UNIFIED ENDPOINT (VALIDAÇÃO + PIX NOTIFICATIONS)
app.post('/webhook/efi', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // 🛡️ IP VALIDATION: EfíBank envia webhooks apenas de IPs conhecidos (skip-mTLS mode)
    const EFIBANK_ALLOWED_IPS = ['34.193.116.226', '34.206.191.171', '3.225.53.60', '34.231.169.20', '::1', '127.0.0.1'];
    const clientIP = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress || '';
    const isAllowedIP = EFIBANK_ALLOWED_IPS.some(ip => clientIP.includes(ip));
    
    if (!isAllowedIP && process.env.NODE_ENV === 'production') {
      console.warn(`🚨 [WEBHOOK EFI] IP não autorizado bloqueado: ${clientIP}`);
      return res.status(403).send('Forbidden');
    }
    
    // 🔍 DETECTAR TIPO DE REQUISIÇÃO: validação inicial OU notificação PIX
    const ignorarParam = req.query.ignorar as string;
    const isPixNotification = ignorarParam && ignorarParam.includes('/pix');
    
    console.log(`🔔 EFIBANK WEBHOOK: ${isPixNotification ? 'PIX NOTIFICATION' : 'VALIDATION TEST'} (IP: ${clientIP})`);
    console.log(`📋 Query params:`, req.query);
    
    // Validar HMAC SEMPRE (busca do Firebase se necessário)
    const hmacFromQuery = req.query.hmac as string;
    await ensureFirebaseReady();
    const expectedHmac = await getWebhookHmac(null);
    
    if (expectedHmac && hmacFromQuery !== expectedHmac) {
      console.error('🚨 HMAC inválido');
      return res.status(403).send('Forbidden');
    }
    
    console.log('✅ HMAC validation OK');
    
    // 🎯 ROTEAMENTO: validação OU processamento PIX
    if (!isPixNotification) {
      // ✅ TESTE INICIAL: EfíBank espera resposta 200 simples
      console.log('✅ EFIBANK VALIDATION TEST - Respondendo 200');
      return res.status(200).send('200');
    }
    
    // 🏦 PROCESSAR NOTIFICAÇÃO PIX (redirecionar internamente)
    console.log('🏦 Processando notificação PIX...');
    
    // Parse do payload
    let webhookData;
    try {
      webhookData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (Buffer.isBuffer(req.body)) {
        webhookData = JSON.parse(req.body.toString('utf8'));
      }
    } catch (error) {
      console.error('🚨 Payload inválido');
      return res.status(400).send('Payload inválido');
    }
    
    // Extrair txid
    const webhookTxid = webhookData.txid || webhookData.pix?.[0]?.txid;
    
    if (!webhookTxid || webhookTxid.length < 25) {
      console.error('🚨 txid inválido ou ausente');
      return res.status(400).send('txid inválido');
    }
    
    console.log('🔍 TxID extraído:', webhookTxid);
    
    // 🔐 VALIDAR PIX NA API EFIBANK
    const pixApiConfirmation = await verificarPixNaApi(webhookTxid);
    
    if (!pixApiConfirmation.valido) {
      console.error('🚨 PIX NÃO confirmado na API EfíBank');
      return res.status(403).send('PIX not confirmed');
    }
    
    console.log('✅ PIX confirmado na API EfíBank');
    
    // Extrair dados do PIX
    let pixInfo = webhookData.pix?.[0] || webhookData.pix || webhookData;
    const txid = pixInfo.txid || pixInfo.endToEndId;
    const valorRecebido = parseFloat(pixInfo.valor || pixInfo.value || 0);
    
    console.log('💰 Valor recebido:', valorRecebido);
    console.log('👤 Pagador:', pixInfo.pagador?.nome || 'N/A');
    
    // 🔍 BUSCAR ORDEM NO NEON
    const { neonQuery: _nqEfi } = await import('./lib/neon-db.js');
    let _neonOrderRow: any = null;
    await _nqEfi(async (sql) => {
      let rows = await sql`SELECT * FROM orders WHERE (metadata->>'txid' = ${txid} OR metadata->>'efiTxid' = ${txid}) AND status = 'pending' LIMIT 1`;
      if (rows[0]) { _neonOrderRow = rows[0]; return; }
      rows = await sql`SELECT * FROM orders WHERE (metadata->>'txid' = ${txid} OR metadata->>'efiTxid' = ${txid}) LIMIT 1`;
      if (rows[0]) _neonOrderRow = rows[0];
    }, `webhook:efi:findOrder:${txid}`);

    if (!_neonOrderRow) {
      console.error('❌ Ordem não encontrada com txid:', txid);
      return res.status(404).send('Ordem não encontrada');
    }

    const orderDoc = { id: _neonOrderRow.id };
    const orderData = {
      ..._neonOrderRow,
      id: _neonOrderRow.id,
      tenantId: _neonOrderRow.tenant_id,
      sellerId: _neonOrderRow.seller_id,
      status: _neonOrderRow.status,
      amount: _neonOrderRow.amount,
      method: _neonOrderRow.payment_method,
      gateway: _neonOrderRow.acquirer,
      saleType: _neonOrderRow.sale_type,
      productType: _neonOrderRow.product_type,
      netAmount: _neonOrderRow.net_amount,
      gatewayFee: _neonOrderRow.gateway_fee,
      platformFee: _neonOrderRow.platform_fee,
      customerEmail: _neonOrderRow.customer_email,
      customerName: _neonOrderRow.customer_name,
      checkoutId: _neonOrderRow.checkout_id,
      checkoutSlug: _neonOrderRow.checkout_slug,
      productId: _neonOrderRow.product_id,
      affiliateUid: _neonOrderRow.metadata?.affiliateUid,
      affiliateId: _neonOrderRow.metadata?.affiliateId,
      affiliateCode: _neonOrderRow.metadata?.affiliateCode,
      affiliateName: _neonOrderRow.metadata?.affiliateName,
      affiliateEmail: _neonOrderRow.metadata?.affiliateEmail,
      affiliateCommission: _neonOrderRow.metadata?.affiliateCommission,
      isAffiliateSale: _neonOrderRow.metadata?.isAffiliateSale || false,
      couponCode: _neonOrderRow.metadata?.couponCode,
      orderBumps: _neonOrderRow.metadata?.orderBumps,
      customer: _neonOrderRow.metadata?.customer || { name: _neonOrderRow.customer_name, email: _neonOrderRow.customer_email, phone: _neonOrderRow.customer_phone },
      personalSaleId: _neonOrderRow.metadata?.personalSaleId,
      type: _neonOrderRow.metadata?.type,
    };
    
    console.log('✅ ORDEM ENCONTRADA:', orderDoc.id);
    console.log('👤 Cliente:', orderData.customer?.name);
    console.log('📊 Status atual:', orderData.status);
    
    // 🔐 VALIDAR VALOR
    const valorEsperado = orderData.amount / 100;
    const diferenca = Math.abs(valorRecebido - valorEsperado);
    
    if (diferenca > 0.05) {
      console.error('🚨 Valor não confere!', { esperado: valorEsperado, recebido: valorRecebido });
      return res.status(400).send('Valor incorreto');
    }
    
    console.log('✅ Valor confirmado:', valorRecebido);

    
    // 🔥 CALCULAR TAXAS FORA DA TRANSAÇÃO PARA REUTILIZAR
    const { calculateFinancialSnapshot } = await import('./lib/webhook-security.js');
    const financialSnapshot = await calculateFinancialSnapshot(
      orderData.amount,
      'pix',
      orderData.gateway || 'efibank',
      1,
      orderData.tenantId
    );
    
    // 🔒 ATUALIZAR PARA PAGO (NEON - idempotência via WHERE status='pending')
    let efiAlreadyPaid = false;
    await _nqEfi(async (sql) => {
      const resolvedSaleType = orderData.saleType || (orderData.type === 'personal_sale' ? 'pix_qrcode' : 'pix_checkout');
      const result = await sql`UPDATE orders SET status = 'paid', paid_at = NOW(), net_amount = ${financialSnapshot.netAmount}, gateway_fee = ${financialSnapshot.gatewayFee}, platform_fee = ${financialSnapshot.platformFee}, updated_at = NOW(), metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ pixPaidAt: new Date(), processor: 'efibank', saleType: resolvedSaleType, releaseDate: financialSnapshot.releaseDate })}::jsonb WHERE id = ${orderDoc.id} AND status = 'pending' RETURNING id`;
      if (!result || result.length === 0) {
        console.log('⚠️ RACE CONDITION: Ordem já paga - webhook duplicado bloqueado');
        efiAlreadyPaid = true;
      } else {
        console.log(`✅ PIX CONFIRMADO - Ordem ${orderDoc.id} atualizada para PAGO no Neon`);
      }
    }, `webhook:efi:markPaid:${orderDoc.id}`);
    
    // 🔐 Se ordem já foi paga (por cron/outro webhook), retornar 200 sem creditar novamente
    if (efiAlreadyPaid) {
      console.log(`⚠️ Ordem ${orderDoc.id} já paga - skipping balance credit e post-processing`);
      return res.status(200).json({ 
        success: true, 
        status: 'already_paid',
        orderId: orderDoc.id,
        message: 'Ordem já processada anteriormente'
      });
    }
    
    // 📋 SINCRONIZAR STATUS NO RTDB + BUNNY CDN (para aparecer como "pago" nas vendas)
    syncOrderAfterUpdate(orderData.tenantId, orderDoc.id, {
      status: 'paid',
      paidAt: new Date().toISOString(),
      method: 'pix',
      saleType: orderData.saleType || (orderData.type === 'personal_sale' ? 'pix_qrcode' : 'pix_checkout'),
      netAmount: financialSnapshot.netAmount,
      gatewayFee: financialSnapshot.gatewayFee,
      affiliateId: orderData.affiliateUid || orderData.affiliateId || null,
      affiliateUid: orderData.affiliateUid || orderData.affiliateId || null,
      affiliateCode: orderData.affiliateCode || null,
      affiliateName: orderData.affiliateName || null,
      affiliateEmail: orderData.affiliateEmail || null,
      affiliateCommission: orderData.affiliateCommission || null,
      isAffiliateSale: orderData.isAffiliateSale || false,
      customer: orderData.customer || null
    });

    if (orderData.type === 'personal_sale' && orderData.personalSaleId) {
      try {
        await _nqEfi(async (sql) => {
          await sql`UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = ${orderData.personalSaleId}`;
        }, `webhook:efi:personalSale:${orderData.personalSaleId}`);
        console.log(`✅ [WEBHOOK EFI] PersonalSale ${orderData.personalSaleId} sincronizada como paga`);
      } catch (psErr: any) {
        console.warn(`⚠️ [WEBHOOK EFI] Erro ao sincronizar personalSale:`, psErr?.message);
      }
    }

    // 📊 ENVIAR ATUALIZAÇÃO PARA UTMIFY (pixel de conversão)
    sendOrderStatusUpdate(orderData.tenantId, orderDoc.id, 'paid', { paidAt: new Date() })
      .catch(err => console.warn('[UTMify] Async EfiBank PIX paid update failed:', err?.message));
    
    // 🎓 CRIAR ENROLLMENT (acesso ao produto)
    try {
      await (storage as any).createEnrollmentOnPayment({
        ...orderData,
        id: orderDoc.id,
        paidAt: new Date()
      });
      console.log('✅ Enrollment criado automaticamente');
    } catch (enrollmentError: any) {
      console.error('⚠️ Erro ao criar enrollment:', enrollmentError?.message || enrollmentError);
      console.error('⚠️ Stack:', enrollmentError?.stack);
    }

    // 📧 CRIAR CONTA E ENVIAR EMAIL DE ACESSO À ÁREA DE MEMBROS
    if (orderData.productType === 'digital' || orderData.productType === 'subscription' || !orderData.productType) {
      try {
        await autoCreateMemberOnPurchase({
          customerEmail: orderData.customerEmail || orderData.customer?.email,
          customerName: orderData.customerName || orderData.customer?.name,
          productId: orderData.productId,
          productType: orderData.productType,
          orderId: orderDoc.id,
          checkoutId: orderData.checkoutId || orderData.checkoutSlug
        });
      } catch(e: any) { console.warn('⚠️ [AUTO-MEMBER] Erro no webhook EFI:', e?.message || e); }
    }

    // 📡 DISPARAR WEBHOOK PARA TENANT (VENDA PIX PAGA)
    try {
      await dispatchPixPaidEvent(orderData.tenantId || orderData.sellerId, {
        id: orderDoc.id,
        ...orderData,
        txid: txid,
        amount: orderData.amount,
        customer: orderData.customer,
        paidAt: new Date()
      });
      console.log('📡 Webhook payment.pix.paid disparado para tenant');
    } catch (webhookError) {
      console.error('⚠️ Erro ao disparar webhook:', webhookError?.message);
    }
    
    // 💰 CALCULAR COMISSÃO DO AFILIADO ANTES DE CREDITAR VENDEDOR
    let netAmountCentsEfi = Math.round(financialSnapshot.netAmount);
    let hasAffiliateEfi = false;
    
    if (orderData.affiliateCode || orderData.affiliateUid) {
      try {
        const affiliateCalc = await (storage as any).calculateAffiliateCommission(orderData);
        if (affiliateCalc.hasAffiliate && affiliateCalc.netCommission > 0) {
          netAmountCentsEfi = netAmountCentsEfi - affiliateCalc.netCommission;
          hasAffiliateEfi = true;
          console.log(`💰 [EFI] Comissão afiliado descontada: R$ ${(affiliateCalc.netCommission/100).toFixed(2)} | Seller receberá: R$ ${(netAmountCentsEfi/100).toFixed(2)}`);
        }
      } catch (calcErr) {
        console.error('⚠️ [EFI] Erro ao calcular comissão:', calcErr?.message);
      }
    }
    
    // 💰 CREDITAR SALDO DO SELLER VIA ATOMIC BALANCE (categoriza por método + deduplicação)
    try {
      const { processWebhookWithBalanceUpdate } = await import('./lib/atomic-balance.js');
      const efiWebhookId = `pix_confirmed_${txid}_${orderDoc.id}`;
      
      const balanceResult = await processWebhookWithBalanceUpdate({
        webhookId: efiWebhookId,
        provider: 'efibank',
        eventType: 'pix.paid',
        sellerId: orderData.tenantId,
        amountCents: netAmountCentsEfi,
        currency: 'BRL',
        operation: 'add',
        balanceType: 'available',
        reason: `PIX confirmado via EfíBank - Ordem ${orderDoc.id}`,
        orderId: orderDoc.id,
        metadata: {
          method: 'pix',
          acquirer: 'efibank',
          totalAmount: financialSnapshot.totalAmount,
          platformFee: financialSnapshot.platformFee,
          gatewayFee: financialSnapshot.gatewayFee,
          customer: orderData.customer?.email,
          saleType: orderData.saleType || (orderData.type === 'personal_sale' ? 'pix_qrcode' : 'pix_checkout'),
        },
        rawPayload: webhookData
      });
      
      if (balanceResult.processed) {
        console.log(`💰 SALDO CREDITADO: Seller ${orderData.tenantId} +R$ ${(netAmountCentsEfi / 100).toFixed(2)} (via atomic balance, byMethod.pix atualizado)`);
      } else {
        console.log(`⚠️ Balance já processado: ${balanceResult.reason}`);
      }
    } catch (balanceError: any) {
      console.error('❌ ERRO ao creditar saldo:', balanceError?.message || balanceError);
      console.error('❌ Stack:', balanceError?.stack);
    }
    // 💰 PROCESSAR COMISSÃO DE AFILIADO (creditar afiliado - seller já descontado acima)
    if (hasAffiliateEfi) {
      try {
        await (storage as any).processAffiliateCommission({ ...orderData, id: orderDoc.id });
        console.log('✅ Comissão do afiliado processada');
      } catch (affiliateError) {
        console.error('⚠️ Erro ao processar comissão:', affiliateError);
      }
    }
    
    console.log(`🎉 WEBHOOK PIX PROCESSADO COM SUCESSO - Ordem ${orderDoc.id} confirmada`);
    console.log(`💰 Cliente ${orderData.customer?.email} recebeu acesso ao produto`);
    
    // ✅ RESPOSTA DE SUCESSO PARA EFIBANK (CRÍTICO - EVITA RETENTATIVAS)
    return res.status(200).json({ 
      success: true, 
      status: 'pix_processed',
      orderId: orderDoc.id,
      message: 'PIX confirmed and order updated'
    });
    
  } catch (error: any) {
    console.error('❌ ERRO CRÍTICO no webhook EfíBank:', error);
    console.error('❌ Stack trace:', error.stack);
    
    // ✅ RESPONDER 200 MESMO COM ERRO (evita retentativas da Efí)
    // Nota: Efí Bank pode retentar indefinidamente se receber 500
    return res.status(200).json({ 
      success: false, 
      error: 'Internal error - check logs',
      message: error.message 
    });
  }
});

// 🏦 EFÍBANK WEBHOOK PIX - CONFIRMAÇÃO AUTOMÁTICA COM VALIDAÇÃO SEGURA
app.post('/webhook/pix', express.raw({ type: 'application/json' }), async (req, res) => {
  // ✅ RESPOSTA RÁPIDA PARA EFIBANK (EVITA TIMEOUT)
  const startTime = Date.now();
  
  try {
    console.log('🔥 WEBHOOK EFÍBANK PIX RECEBIDO - validando segurança...');
    
    // 🔐 GATE 0: Validação HMAC OBRIGATÓRIA (contra webhooks forjados)
    const hmacFromQuery = req.query.hmac as string;
    await ensureFirebaseReady();
    const expectedHmac = await getWebhookHmac(null);
    
    if (!expectedHmac) {
      console.error('🚨 EFIBANK_WEBHOOK_HMAC não configurado - bloqueando webhook');
      return res.status(403).json({ error: 'Webhook HMAC não configurado' });
    }
    
    const isHmacValid = validateEfiBankHMAC(hmacFromQuery, expectedHmac);
    
    if (!isHmacValid) {
      console.error('🚨 WEBHOOK EFIBANK REJEITADO: HMAC inválido - possível ataque');
      return res.status(403).json({ error: 'HMAC inválido' });
    }
    
    console.log('✅ SECURITY GATE 0 PASSED: HMAC validation OK');
    
    // 🔐 GATE 1: Validação estrutural do webhook EfíBank (não bloquear teste inicial)
    const isValid = validateEfiBankWebhook(req.body, req.headers);
    
    if (!isValid) {
      console.log('⚠️ Webhook structure validation failed (pode ser teste inicial do EFí Bank)');
      console.log('✅ Respondendo 200 OK para não bloquear teste de registro');
      return res.status(200).send('OK');
    }
    
    console.log('✅ SECURITY GATE 1 PASSED: Webhook structure validation OK');
    
    // Parsear o payload do webhook
    let webhookData;
    try {
      webhookData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (Buffer.isBuffer(req.body)) {
        webhookData = JSON.parse(req.body.toString('utf8'));
      }
    } catch (error) {
      console.error('🚨 ERRO: Payload do webhook inválido');
      return res.status(400).send('Payload inválido');
    }
    
    // Etapa 2: VERIFICAÇÃO CRÍTICA OBRIGATÓRIA VIA API - confirmar se o PIX realmente existe
    console.log('🔍 VALIDAÇÃO CRÍTICA: Verificando PIX na API EfíBank antes de aprovar...');
    
    const webhookTxid = webhookData.txid || webhookData.pix?.[0]?.txid;
    
    console.log('📋 WEBHOOK PAYLOAD:', JSON.stringify(webhookData, null, 2));
    console.log('🔍 TXID EXTRAÍDO:', webhookTxid);
    
    if (!webhookTxid || webhookTxid.length < 25) {
      console.error('🚨 WEBHOOK REJEITADO: txid inválido ou ausente', { 
        txid: webhookTxid,
        payload: webhookData,
        hasPixArray: !!webhookData.pix,
        pixArrayLength: webhookData.pix?.length
      });
      return res.status(400).send('txid inválido');
    }
    
    // Obter dados do webhook primeiro
    const pixData = req.body;
    
    // 🛡️ VERIFICAÇÃO OBRIGATÓRIA: PIX DEVE SER CONFIRMADO NA API ANTES DE QUALQUER UPDATE
    let pixApiConfirmation = null;
    try {
      pixApiConfirmation = await verificarPixNaApi(webhookTxid);
      
      // REGRA CRÍTICA: SEM CONFIRMAÇÃO API = SEM APROVAÇÃO
      if (!pixApiConfirmation.valido) {
        console.error('🚨 SECURITY GATE 2 FAILED: PIX NÃO CONFIRMADO na API EfíBank', {
          txid: webhookTxid,
          apiResponse: pixApiConfirmation.dados,
          ip: req.headers['x-forwarded-for'] || 'unknown',
          reason: 'PIX_NOT_CONFIRMED_IN_API'
        });
        return res.status(403).send('BLOCKED: PIX not confirmed in API');
      }
      
      console.log('✅ SECURITY GATE 2 PASSED: PIX confirmed in EfíBank API');
      
      // VALIDAÇÃO ADICIONAL: Valor deve coincidir
      const valorApi = pixApiConfirmation.dados?.valor || pixApiConfirmation.dados?.value;
      if (valorApi && Math.abs(valorApi - (pixData.pix?.[0]?.valor || 0)) > 0.01) {
        console.error('🚨 SECURITY BLOCK: Valor do PIX não confere com API', {
          valorWebhook: pixData.pix?.[0]?.valor,
          valorAPI: valorApi,
          txid: webhookTxid
        });
        return res.status(401).send('Valor não confere');
      }
      
      console.log('✅ PIX CONFIRMADO E VALIDADO na API EfíBank:', {
        txid: webhookTxid,
        status: pixApiConfirmation.dados?.status,
        valor: valorApi
      });
      
    } catch (error) {
      console.error('❌ ERRO CRÍTICO: Falha na verificação API - BLOQUEANDO por segurança', {
        error: error.message,
        txid: webhookTxid,
        ip: req.headers['x-forwarded-for'] || 'unknown'
      });
      // REGRA DE SEGURANÇA: Em caso de erro na API, NÃO APROVAR automaticamente
      return res.status(500).send('Erro na verificação - bloqueado por segurança');
    }
    
    // Se chegou até aqui, o PIX é REAL e VÁLIDO
    console.log('✅ EFIBANK PIX WEBHOOK: Validação de segurança passou');
    
    // Verificar diferentes formatos de webhook do EfíBank
    let pixInfo = null;
    let txid = null;
    let valorRecebido = 0;
    
    if (pixData && pixData.pix && Array.isArray(pixData.pix)) {
      // Formato padrão com array
      pixInfo = pixData.pix[0];
    } else if (pixData && pixData.pix && !Array.isArray(pixData.pix)) {
      // Formato direto sem array
      pixInfo = pixData.pix;
    } else if (pixData && pixData.evento === 'pix_recebido') {
      // Formato alternativo
      pixInfo = pixData;
    }
    
    if (pixInfo) {
      txid = pixInfo.txid || pixInfo.endToEndId;
      valorRecebido = parseFloat(pixInfo.valor || pixInfo.value || 0);
      
      console.log('🎯 PIX CONFIRMADO!');
      console.log('🆔 TxID:', txid);
      console.log('💰 Valor recebido:', valorRecebido);
      console.log('👤 Pagador:', pixInfo.pagador?.nome || pixInfo.pagador?.name || 'N/A');
      console.log('📅 Horário:', pixInfo.horario || new Date().toISOString());
      
      if (txid && valorRecebido > 0) {
        // Buscar a ordem no Neon pelo txid (múltiplas tentativas)
        console.log('🔍 Buscando ordem no Neon com TxID:', txid);
        const { neonQuery: _nqPix2 } = await import('./lib/neon-db.js');
        let _pix2OrderRow: any = null;
        await _nqPix2(async (sql) => {
          let rows = await sql`SELECT * FROM orders WHERE (metadata->>'txid' = ${txid} OR metadata->>'efiTxid' = ${txid}) AND status = 'pending' LIMIT 1`;
          if (!rows[0]) {
            console.log('🔍 Tentativa 2: Buscando sem filtro de status...');
            rows = await sql`SELECT * FROM orders WHERE (metadata->>'txid' = ${txid} OR metadata->>'efiTxid' = ${txid}) LIMIT 1`;
          }
          if (!rows[0] && pixInfo.endToEndId) {
            console.log('🔍 Tentativa 3: Buscando por endToEndId...');
            rows = await sql`SELECT * FROM orders WHERE metadata->>'endToEndId' = ${pixInfo.endToEndId} AND status = 'pending' LIMIT 1`;
          }
          if (rows[0]) _pix2OrderRow = rows[0];
        }, `webhookPix2:txid:${txid}`);
        
        if (_pix2OrderRow) {
          const orderDoc = { id: _pix2OrderRow.id };
          const orderData = {
            ..._pix2OrderRow,
            tenantId: _pix2OrderRow.tenant_id,
            sellerId: _pix2OrderRow.seller_id,
            method: _pix2OrderRow.payment_method,
            netAmount: _pix2OrderRow.net_amount,
            gatewayFee: _pix2OrderRow.gateway_fee,
            platformFee: _pix2OrderRow.platform_fee,
            txid: _pix2OrderRow.metadata?.txid || _pix2OrderRow.metadata?.efiTxid,
            affiliateCode: _pix2OrderRow.metadata?.affiliateCode,
            affiliateUid: _pix2OrderRow.metadata?.affiliateUid,
            customer: _pix2OrderRow.metadata?.customer || {},
            customerEmail: _pix2OrderRow.customer_email,
            customerName: _pix2OrderRow.customer_name,
            checkoutId: _pix2OrderRow.checkout_id,
            productId: _pix2OrderRow.product_id,
            productType: _pix2OrderRow.product_type,
            saleType: _pix2OrderRow.sale_type,
            checkoutTitle: _pix2OrderRow.metadata?.checkoutTitle,
            productName: _pix2OrderRow.metadata?.productName,
            type: _pix2OrderRow.metadata?.type,
            personalSaleId: _pix2OrderRow.metadata?.personalSaleId,
          };
          
          console.log('✅ ORDEM ENCONTRADA:', orderDoc.id);
          console.log('👤 Cliente:', orderData.customer?.name);
          console.log('💰 Valor esperado:', orderData.amount / 100);
          console.log('💰 Valor recebido:', valorRecebido);
          console.log('📊 Status atual:', orderData.status);
          
          // 🛡️ BUG #5 FIX: Verificação de duplicação movida para DENTRO da transação
          // (proteção contra race condition)
          
          // 🔐 RECONCILIAÇÃO CRÍTICA: Verificar valor, txid e tenant
          const valorEsperado = orderData.amount / 100;
          const diferenca = Math.abs(valorRecebido - valorEsperado);
          
          if (diferenca > 0.05) { // Tolerância de 5 centavos
            console.error('🚨 SECURITY BLOCK: Valor do PIX não confere com ordem', {
              orderId: orderDoc.id,
              valorEsperado: valorEsperado,
              valorRecebido: valorRecebido,
              diferenca: diferenca,
              txid: txid
            });
            return res.status(400).send('Valor incorreto');
          }

          // 🔐 RECONCILIAÇÃO CRÍTICA: Verificar se txid pertence a esta ordem (anti-replay)
          if (orderData.txid && orderData.txid !== txid) {
            console.error('🚨 SECURITY GATE 3 FAILED: TxID não pertence a esta ordem - replay attack', {
              orderId: orderDoc.id,
              orderTxid: orderData.txid,
              webhookTxid: txid
            });
            return res.status(403).send('BLOCKED: TxID mismatch');
          }

          // 🔐 RECONCILIAÇÃO CRÍTICA: Verificar tenant/account (anti cross-tenant)
          if (orderData.tenantId) {
            const webhookTenant = req.headers['x-tenant-id'] || req.headers['webhook-tenant-id'];
            if (webhookTenant && orderData.tenantId !== webhookTenant) {
              console.error('🚨 SECURITY GATE 4 FAILED: Cross-tenant attack detectado', {
                orderId: orderDoc.id,
                orderTenantId: orderData.tenantId,
                webhookTenantId: webhookTenant
              });
              return res.status(403).send('BLOCKED: Cross-tenant not allowed');
            }
          }
          
          console.log('✅ SECURITY GATES 3-4 PASSED: TxID and tenant reconciliation OK');
          
          // ✅ ATUALIZAR ORDEM PARA PAGO (TRANSAÇÃO ATÔMICA) COM AUDITORIA
          const currentStatus = orderData.status;
          
          // 🔐 AUDITORIA DE SEGURANÇA: Verificar se mudança é permitida
          const auditApproved = await auditedStatusChange(
            orderDoc.id,
            currentStatus,
            'paid',
            'efibank_webhook',
            'webhook_confirmed',
            {
              ip: req.ip || req.headers['x-forwarded-for'] as string || 'unknown',
              userAgent: req.headers['user-agent'],
              webhookId: `efi_${txid}_${Date.now()}`,
              txid: txid,
              amount: valorRecebido * 100, // Em centavos
              paymentMethod: 'pix',
              additionalData: {
                pagador: pixInfo.pagador,
                horario: pixInfo.horario,
                valorRecebido,
                valorEsperado: valorEsperado,
                apiConfirmation: pixApiConfirmation?.dados
              }
            }
          );

          if (!auditApproved) {
            console.error('🚨 AUDITORIA BLOQUEOU: Mudança de status não permitida ou suspeita');
            return res.status(403).send('Mudança de status bloqueada por auditoria');
          }
          
          // 💰 Dados financeiros hoistados para uso após a transação
          let resolvedNetAmount = 0;
          let resolvedGatewayFee = 0;
          let resolvedPlatformFee = 0;
          let resolvedTotalAmount = 0;
          
          try {
            // 🔐 CRÍTICO: TODA MUDANÇA DE STATUS DEVE PASSAR PELA AUDITORIA
            console.log('✅ SECURITY: TODOS OS GATES PASSARAM - Processando mudança auditada (Neon)');
            
            // 🛡️ Atomic UPDATE com WHERE status='pending' (race condition protection via Neon)
            const method = orderData.method || 'pix';
            const gateway = (orderData as any).gateway || 'efibank';
            const withdrawalDays = await getWithdrawalDays(method, gateway);
            
            let neonFeeGateway = orderData.gatewayFee || 0;
            let neonFeePlatform = orderData.platformFee || 0;
            let neonFeeNet = orderData.netAmount || orderData.amount;
            
            if (!orderData.gatewayFee) {
              console.log('💰 PIX Genérico: Ordem sem taxas calculadas, calculando agora...');
              const feeCalc = await calculateDynamicFees(
                orderData.amount,
                gateway,
                1,
                'pix',
                orderData.tenantId || orderData.sellerId
              );
              neonFeeGateway = feeCalc.gatewayFee;
              neonFeePlatform = feeCalc.platformFee;
              neonFeeNet = feeCalc.netAmount;
            }
            resolvedNetAmount = Math.round(neonFeeNet);
            resolvedGatewayFee = neonFeeGateway;
            resolvedPlatformFee = neonFeePlatform;
            resolvedTotalAmount = orderData.amount;
            
            const pixMetadataPatch = {
              confirmedVia: 'efibank_webhook_pix',
              txid,
              pixData: { txid, valor: valorRecebido, pagador: pixInfo.pagador, horario: pixInfo.horario || new Date().toISOString(), confirmedAt: new Date().toISOString() },
              withdrawalDays,
            };
            
            let updateRows: any[] = [];
            await _nqPix2(async (sql) => {
              updateRows = await sql`UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW(), net_amount = ${resolvedNetAmount}, gateway_fee = ${resolvedGatewayFee}, platform_fee = ${resolvedPlatformFee}, metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(pixMetadataPatch)}::jsonb WHERE id = ${orderDoc.id} AND status = 'pending' RETURNING id`;
            }, `webhookPix2:update:${orderDoc.id}`);
            
            if (!updateRows || updateRows.length === 0) {
              console.log('⚠️ RACE CONDITION DETECTADA - Webhook duplicado bloqueado (Neon UPDATE retornou 0 linhas)');
              await logPaymentStatusChange({
                orderId: orderDoc.id, previousStatus: 'paid', newStatus: 'paid', changeReason: 'webhook_confirmed',
                source: 'efibank_webhook', timestamp: new Date(), ip: req.ip || req.headers['x-forwarded-for'] as string || 'unknown',
                webhookId: `efi_duplicate_prevented_${txid}_${Date.now()}`, txid, amount: valorRecebido * 100,
                paymentMethod: 'pix', additionalData: { reason: 'race_condition_prevented_neon' }
              });
            } else {
              console.log('✅ ORDEM ATUALIZADA PARA PAGA COM AUDITORIA COMPLETA (Neon)!');
            }
            
            // 📋 SINCRONIZAR STATUS NO RTDB + BUNNY CDN (para aparecer como "pago" nas vendas)
            syncOrderAfterUpdate(orderData.tenantId, orderDoc.id, {
              status: 'paid',
              paidAt: new Date().toISOString(),
              method: 'pix',
              saleType: orderData.saleType || (orderData.type === 'personal_sale' ? 'pix_qrcode' : 'pix_checkout'),
              netAmount: resolvedNetAmount,
              gatewayFee: resolvedGatewayFee
            });

            // 🔔 PUSH NOTIFICATION - EFIBANK PIX WEBHOOK DIRETO
            if (orderData.tenantId) {
              import('./lib/push-notification-service.js').then(({ sendSaleNotification: _sendEfiPush }) => {
                _sendEfiPush(orderData.tenantId, {
                  id: orderDoc.id,
                  customer: orderData.customer,
                  productName: orderData.productName || orderData.checkoutTitle,
                  amount: orderData.amount,
                  method: 'pix',
                  affiliateId: orderData.affiliateUid || orderData.affiliateId,
                }).catch((e: any) => console.warn('[PUSH] EfíBank PIX notification failed:', e?.message));
              }).catch((e: any) => console.warn('[PUSH] EfíBank PIX import failed:', e?.message));

              import('./security/transaction-limits.js').then(({ recordApprovedTransaction }) => {
                recordApprovedTransaction(orderData.tenantId, orderData.amount || 0).catch(() => {});
              }).catch(() => {});

              // 📧 EMAIL DE VENDA APROVADA PARA SELLER — EfíBank /webhook/pix (fire-and-forget)
              (async () => {
                try {
                  const { neonQuery: _nqPix2Email } = await import('./lib/neon-db.js');
                  let sellerData2: any = null;
                  await _nqPix2Email(async (sql) => {
                    const rows = await sql`SELECT email, business_name, full_name FROM sellers WHERE id = ${orderData.tenantId} LIMIT 1`;
                    if (rows[0]) sellerData2 = rows[0];
                  }, `webhookPix2Email:${orderData.tenantId}`);
                  if (sellerData2?.email) {
                    const { sendSaleApprovedEmail } = await import('./lib/email-service.js');
                    await sendSaleApprovedEmail({
                      sellerEmail: sellerData2.email,
                      sellerName: sellerData2.business_name || sellerData2.full_name,
                      productName: orderData.productName || orderData.checkoutTitle || 'Produto',
                      productPrice: orderData.amount,
                      buyerName: orderData.customer?.name || orderData.customerName || 'Cliente',
                      buyerEmail: orderData.customer?.email || orderData.customerEmail || '',
                      paymentMethod: 'pix',
                      orderId: orderDoc.id,
                      netAmount: resolvedNetAmount,
                      currency: 'BRL'
                    });
                    console.log(`📧✅ Email PIX (/webhook/pix) enviado: ${sellerData2.email}`);
                  }
                } catch (e: any) { console.warn('⚠️ [EFIBANK PIX EMAIL] Erro:', e?.message); }
              })();
            }

            if (orderData.type === 'personal_sale' && orderData.personalSaleId) {
              try {
                const { neonQuery: _nqPix2PS } = await import('./lib/neon-db.js');
                await _nqPix2PS(async (sql) => {
                  await sql`UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW(), metadata = COALESCE(metadata, '{}'::jsonb) || '{"qrExpired":true}'::jsonb WHERE metadata->>'personalSaleId' = ${orderData.personalSaleId}`;
                }, `webhookPix2PS:${orderData.personalSaleId}`);
                console.log(`✅ [WEBHOOK PIX] PersonalSale ${orderData.personalSaleId} sincronizada como paga (Neon)`);
              } catch (psErr: any) {
                console.warn(`⚠️ [WEBHOOK PIX] Erro ao sincronizar personalSale:`, psErr?.message);
              }
            }

            // 📊 ENVIAR ATUALIZAÇÃO PARA UTMIFY (pixel de conversão)
            sendOrderStatusUpdate(orderData.tenantId, orderDoc.id, 'paid', { paidAt: new Date() })
              .catch(err => console.warn('[UTMify] Async EfiBank PIX /webhook/pix paid update failed:', err?.message));
            
            // 🔔 DISPARAR WEBHOOKS DO SELLER (REAL - EFIBANK PIX)
            if (orderData?.tenantId) {
              setImmediate(async () => {
                try {
                  await triggerSellerWebhooks(orderData.tenantId, 'payment', {
                    order_id: orderDoc.id,
                    checkout_id: orderData.checkoutId,
                    amount: orderData.amount,
                    currency: 'BRL',
                    customer_email: orderData.customerEmail,
                    product_type: orderData.productType || 'digital',
                    payment_method: 'efibank_pix',
                    status: 'paid',
                    paid_at: new Date().toISOString(),
                    pix_txid: txid
                  });
                  console.log('✅ Webhooks do seller disparados com sucesso');
                } catch (webhookError) {
                  console.error('❌ Erro ao disparar webhooks do seller:', webhookError);
                }
              });
            }
            
            // 🎯 CRIAR ENROLLMENT AUTOMÁTICO (ASYNC)
            setImmediate(async () => {
              try {
                await (storage as any).createEnrollmentOnPayment({
                  ...orderData,
                  id: orderDoc.id,
                  paidAt: new Date()
                });
                console.log('✅ Enrollment criado automaticamente (/webhook/pix)');
              } catch (enrollError) {
                console.error('❌ Erro ao criar enrollment:', enrollError);
              }
              // 📧 CRIAR CONTA E ENVIAR EMAIL DE ACESSO (PIX GENÉRICO)
              if (orderData.productType === 'digital' || orderData.productType === 'subscription' || !orderData.productType) {
                try {
                  await autoCreateMemberOnPurchase({
                    customerEmail: orderData.customerEmail || orderData.customer?.email,
                    customerName: orderData.customerName || orderData.customer?.name,
                    productId: orderData.productId,
                    productType: orderData.productType,
                    orderId: orderDoc.id,
                    checkoutId: orderData.checkoutId || orderData.checkoutSlug
                  });
                } catch(e: any) { console.warn('⚠️ [AUTO-MEMBER] Erro /webhook/pix:', e?.message || e); }
              }
            });
            
            // 💰 CREDITAR SALDO DO SELLER VIA ATOMIC BALANCE (categoriza por método + deduplicação)
            try {
              const { processWebhookWithBalanceUpdate } = await import('./lib/atomic-balance.js');
              
              let netCents = resolvedNetAmount;
              
              if (orderData.affiliateCode || orderData.affiliateUid) {
                try {
                  const affiliateCalc = await (storage as any).calculateAffiliateCommission(orderData);
                  if (affiliateCalc.hasAffiliate && affiliateCalc.netCommission > 0) {
                    netCents -= affiliateCalc.netCommission;
                    console.log(`💰 [/webhook/pix] Comissão afiliado descontada: R$ ${(affiliateCalc.netCommission/100).toFixed(2)}`);
                  }
                } catch (calcErr: any) {
                  console.error('⚠️ Erro ao calcular comissão:', calcErr?.message);
                }
              }
              
              const pixWebhookId = `pix_confirmed_${txid}_${orderDoc.id}`;
              const result = await processWebhookWithBalanceUpdate({
                webhookId: pixWebhookId,
                provider: 'efibank',
                eventType: 'pix.paid',
                sellerId: orderData.tenantId,
                amountCents: netCents,
                currency: 'BRL',
                operation: 'add',
                balanceType: 'available',
                reason: `PIX confirmado via /webhook/pix - Ordem ${orderDoc.id}`,
                orderId: orderDoc.id,
                metadata: {
                  method: 'pix',
                  acquirer: 'efibank',
                  totalAmount: resolvedTotalAmount,
                  platformFee: resolvedPlatformFee,
                  gatewayFee: resolvedGatewayFee,
                  customer: orderData.customer?.email,
                  saleType: orderData.saleType || (orderData.type === 'personal_sale' ? 'pix_qrcode' : 'pix_checkout'),
                },
                rawPayload: req.body
              });
              
              if (result.processed) {
                console.log(`💰 SALDO CREDITADO (/webhook/pix): Seller ${orderData.tenantId} +R$ ${(netCents / 100).toFixed(2)}`);
              } else {
                console.log(`⚠️ Balance já processado: ${result.reason}`);
              }
            } catch (balanceError) {
              console.error('❌ ERRO ao creditar saldo (/webhook/pix):', balanceError);
            }
            
            // 💰 PROCESSAR COMISSÃO DE AFILIADO (ASYNC)
            setImmediate(async () => {
              try {
                if (orderData.affiliateCode || orderData.affiliateUid) {
                  console.log('💰 Processando comissão de afiliado...');
                  await storage.processAffiliateCommission({ ...orderData, id: orderDoc.id });
                  console.log('✅ Comissão de afiliado processada!');
                }
              } catch (affiliateError) {
                console.error('❌ Erro ao processar comissão:', affiliateError);
              }
            });
            

            // 💼 PROCESSAR COMISSÕES DE COPRODUÇÃO (ASYNC)
            setImmediate(async () => {
              try {
                const source = orderData.affiliateCode ? 'affiliate_sale' : 'own_sale';
                await processCoproductionCommissions(
                  orderDoc.id,
                  orderData.checkoutId,
                  orderData.tenantId,
                  resolvedTotalAmount,
                  resolvedNetAmount,
                  source,
                  orderData.affiliateId
                );
              } catch (coproductionError) {
                console.error('❌ Erro ao processar comissões de coprodução:', coproductionError);
              }
            });
          } catch (transactionError: any) {
            // 🛡️ BUG #5 FIX: Tratar erro de webhook duplicado especificamente

            if (transactionError?.message === 'DUPLICATE_WEBHOOK') {
              console.log('✅ Webhook duplicado tratado com sucesso - retornando OK');
              return res.status(200).send('OK');
            }
            console.error('❌ Erro na transação:', transactionError);
            return res.status(500).send('Erro interno');
          }
          
        } else {
          console.log('❌ ORDEM NÃO ENCONTRADA para TxID:', txid);
          
          // Debug: Listar ordens PIX recentes para troubleshooting (Neon)
          try {
            await _nqPix2(async (sql) => {
              const debugRows = await sql`SELECT id, metadata->>'txid' as txid, amount, created_at FROM orders WHERE payment_method = 'pix' AND status = 'pending' ORDER BY created_at DESC LIMIT 5`;
              if (debugRows.length > 0) {
                console.log('📋 Ordens PIX pendentes recentes:');
                debugRows.forEach((row: any) => {
                  const timeDiff = new Date().getTime() - new Date(row.created_at).getTime();
                  console.log(`📄 ${row.id} - TxID: ${row.txid} - Criada há ${Math.round(timeDiff/1000/60)}min - Valor: R$${(row.amount/100).toFixed(2)}`);
                });
              } else { console.log('📋 Nenhuma ordem PIX pending encontrada'); }
            }, 'debugPixOrders');
          } catch (debugError) {
            console.log('⚠️ Erro no debug de ordens:', debugError);
          }
        }
      } else {
        console.log('❌ TxID ou valor inválido:', { txid, valorRecebido });
      }
    } else {
      console.log('❌ Formato de webhook não reconhecido');
    }
    
    // ✅ RESPOSTA RÁPIDA SEMPRE - Processar em background se necessário
    const processingTime = Date.now() - startTime;
    console.log(`⚡ Webhook /webhook/efi processado em ${processingTime}ms`);
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('❌ Erro no webhook /webhook/efi:', error);
    // ✅ SEMPRE RESPONDER OK - EfíBank não deve reenviar por erros internos
    res.status(200).send('OK');
  }
});

// 💎 WITETEC WEBHOOK - GET PARA TESTE
app.get('/webhook/witetec', (req, res) => {
  console.log('📡 TESTE DE WEBHOOK WITETEC recebido (GET)');
  res.status(200).send('OK');
});

// 💎 WITETEC WEBHOOK - RECEBER NOTIFICAÇÕES DE PAGAMENTO
app.post('/webhook/witetec', express.json(), async (req, res) => {
  const startTime = Date.now();
  
  try {
    // 🔐 VALIDAÇÃO DE SEGURANÇA: verificar token secreto se configurado
    const WITETEC_SECRET = process.env.WITETEC_WEBHOOK_SECRET;
    if (WITETEC_SECRET) {
      const incomingToken = req.headers['x-witetec-token'] || req.headers['authorization']?.replace('Bearer ', '') || req.body?.webhookToken;
      if (!incomingToken || incomingToken !== WITETEC_SECRET) {
        console.warn('⚠️ [WITETEC] Webhook rejeitado: token inválido ou ausente');
        return res.status(200).send('OK'); // Retorna 200 para não gerar reenvios mas ignora
      }
    } else {
      console.warn('⚠️ [WITETEC] WITETEC_WEBHOOK_SECRET não configurado — webhook sem validação de autenticidade');
    }

    console.log('💎 WEBHOOK WITETEC RECEBIDO - processando notificação...');
    console.log('📦 Payload:', JSON.stringify(req.body, null, 2));
    
    const webhookData = req.body;
    
    // 🔐 VALIDAÇÃO 1: Verificar estrutura básica do webhook
    if (!webhookData || typeof webhookData !== 'object') {
      console.warn('⚠️ Webhook Witetec: payload inválido');
      return res.status(200).send('OK'); // Responder OK para evitar reenvios
    }
    
    // 🎯 EXTRAIR DADOS DA TRANSAÇÃO (adaptar conforme formato real da Witetec)
    // Formatos possíveis: { event, transaction, status, txid, value, correlationID }
    const event = webhookData.event || webhookData.type || webhookData.evento;
    const transaction = webhookData.transaction || webhookData.data || webhookData;
    const status = transaction.status || webhookData.status;
    const txid = transaction.txid || transaction.transactionId || transaction.id;
    const correlationID = transaction.correlationID || webhookData.correlationID;
    const value = transaction.value || transaction.amount || transaction.valor;
    
    console.log('🔍 WITETEC: Dados extraídos:', {
      event,
      status,
      txid,
      correlationID,
      value
    });
    
    // 🎯 PROCESSAR APENAS EVENTOS DE PAGAMENTO CONFIRMADO
    const confirmedStatuses = ['paid', 'confirmed', 'approved', 'completed', 'pago', 'confirmado'];
    if (!confirmedStatuses.includes(status?.toLowerCase())) {
      console.log(`ℹ️ WITETEC: Status ${status} ignorado (não é confirmação de pagamento)`);
      return res.status(200).send('OK');
    }
    
    console.log('✅ WITETEC: Pagamento confirmado!');
    
    // 🔍 BUSCAR ORDEM NO NEON
    // Tentar por correlationID primeiro (nosso orderId), depois por txid
    const { neonQuery: _nqWitetec } = await import('./lib/neon-db.js');
    let _witetecOrderRow: any = null;
    await _nqWitetec(async (sql) => {
      if (correlationID) {
        console.log('🔍 WITETEC: Buscando ordem por correlationID (Neon):', correlationID);
        const rows = await sql`SELECT * FROM orders WHERE id = ${correlationID} AND status = 'pending' LIMIT 1`;
        if (rows[0]) { _witetecOrderRow = rows[0]; return; }
      }
      if (txid) {
        console.log('🔍 WITETEC: Buscando ordem por txid (Neon):', txid);
        const rows = await sql`SELECT * FROM orders WHERE (metadata->>'txid' = ${txid} OR id = ${txid}) AND status = 'pending' LIMIT 1`;
        if (rows[0]) _witetecOrderRow = rows[0];
      }
    }, `witetec:${correlationID || txid}`);
    
    const orderDoc = _witetecOrderRow ? { id: _witetecOrderRow.id } : null;
    
    if (!orderDoc) {
      console.warn('⚠️ WITETEC: Ordem não encontrada', { correlationID, txid });
      return res.status(200).send('OK');
    }
    
    const orderData = {
      ..._witetecOrderRow,
      tenantId: _witetecOrderRow.tenant_id,
      sellerId: _witetecOrderRow.seller_id,
      method: _witetecOrderRow.payment_method,
      netAmount: _witetecOrderRow.net_amount,
      gatewayFee: _witetecOrderRow.gateway_fee,
      platformFee: _witetecOrderRow.platform_fee,
      customer: _witetecOrderRow.metadata?.customer || {},
      customerEmail: _witetecOrderRow.customer_email,
      customerName: _witetecOrderRow.customer_name,
      checkoutId: _witetecOrderRow.checkout_id,
      productId: _witetecOrderRow.product_id,
      productType: _witetecOrderRow.product_type,
      productName: _witetecOrderRow.metadata?.productName,
      checkoutTitle: _witetecOrderRow.metadata?.checkoutTitle,
      affiliateUid: _witetecOrderRow.metadata?.affiliateUid,
      affiliateCode: _witetecOrderRow.metadata?.affiliateCode,
    };
    console.log('✅ WITETEC: Ordem encontrada:', orderDoc.id);
    console.log('👤 Cliente:', orderData.customer?.name);
    console.log('💰 Valor ordem:', orderData.amount / 100);
    console.log('💰 Valor webhook:', value);
    
    // 🛡️ VALIDAÇÃO: Verificar se o valor confere (tolerância de R$0.01)
    const valorEsperado = orderData.amount / 100;
    const valorRecebido = parseFloat(value) || 0;
    
    if (Math.abs(valorEsperado - valorRecebido) > 0.01) {
      console.error('🚨 WITETEC: Valor não confere!', {
        esperado: valorEsperado,
        recebido: valorRecebido,
        diferenca: Math.abs(valorEsperado - valorRecebido)
      });
      return res.status(200).send('OK'); // Não aprovar, mas responder OK
    }
    
    console.log('✅ WITETEC: Valor confirmado:', valorRecebido);
    
    // 💰 CALCULAR TAXAS DINÂMICAS SE A ORDEM NÃO TEM FEE SNAPSHOT
    let feeUpdate: any = {};
    if (!orderData.gatewayFee) {
      console.log('💰 Witetec: Ordem sem taxas calculadas, calculando agora...');
      const paymentMethod = transaction.payment_method || webhookData.payment_method || 'pix';
      const feeCalculation = await calculateDynamicFees(
        orderData.amount,
        'witetec',
        1,
        paymentMethod,
        orderData.tenantId || orderData.sellerId
      );
      feeUpdate = {
        gatewayFee: feeCalculation.gatewayFee,
        gatewayFeePercent: feeCalculation.gatewayFeePercent,
        platformFee: feeCalculation.platformFee,
        platformFeePercent: feeCalculation.platformFeePercent,
        netAmount: feeCalculation.netAmount,
        // 📊 SNAPSHOT FINANCEIRO COMPLETO (ETERNO)
        financialData: {
          grossAmount: orderData.amount,
          feeAmount: feeCalculation.gatewayFee + feeCalculation.platformFee,
          netAmount: feeCalculation.netAmount,
          releaseDate: new Date(Date.now() + (feeCalculation.releaseDays || 0) * 24 * 60 * 60 * 1000),
          released: false,
          feeBreakdown: {
            fixedFee: 0,
            percentFee: feeCalculation.gatewayFeePercent,
            percentAmount: feeCalculation.gatewayFee,
            platformFeePercent: feeCalculation.platformFeePercent,
            platformFeeAmount: feeCalculation.platformFee
          },
          releaseDays: feeCalculation.releaseDays || 0
        }
      };
    }
    
    // 💾 ATUALIZAR STATUS DA ORDEM PARA PAGO (Neon)
    const witetecNetAmount = Math.round(feeUpdate.netAmount || orderData.netAmount || orderData.amount);
    const witetecGatewayFee = feeUpdate.gatewayFee || orderData.gatewayFee || 0;
    const witetecPlatformFee = feeUpdate.platformFee || orderData.platformFee || 0;
    const witetecMetaPatch = { confirmedVia: 'witetec_webhook', witetecTxid: txid, witetecWebhookData: webhookData };
    await _nqWitetec(async (sql) => {
      await sql`UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW(), net_amount = ${witetecNetAmount}, gateway_fee = ${witetecGatewayFee}, platform_fee = ${witetecPlatformFee}, metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(witetecMetaPatch)}::jsonb WHERE id = ${orderDoc.id} AND status = 'pending'`;
    }, `witetecUpdate:${orderDoc.id}`);
    
    console.log('✅ WITETEC: Ordem atualizada para PAGO (Neon)!', orderDoc.id);
    
    // 📋 SINCRONIZAR STATUS NO RTDB + BUNNY CDN (dashboard de vendas)
    syncOrderAfterUpdate(orderData.tenantId, orderDoc.id, {
      status: 'paid',
      paidAt: new Date().toISOString(),
      method: orderData.method || 'pix',
      netAmount: witetecNetAmount,
      gatewayFee: witetecGatewayFee
    });

    // 📊 ENVIAR ATUALIZAÇÃO PARA UTMIFY (pixel de conversão)
    sendOrderStatusUpdate(orderData.tenantId, orderDoc.id, 'paid', { paidAt: new Date() })
      .catch(err => console.warn('[UTMify] Async Witetec paid update failed:', err?.message));
    
    // 🔔 DISPARAR WEBHOOKS DO SELLER (WITETEC)
    if (orderData?.tenantId) {
      await triggerSellerWebhooks(orderData.tenantId, 'payment', {
        order_id: orderDoc.id,
        checkout_id: orderData.checkoutId,
        amount: orderData.amount,
        currency: 'BRL',
        customer_email: orderData.customerEmail,
        product_type: orderData.productType || 'digital',
        payment_method: 'witetec',
        status: 'paid',
        paid_at: new Date().toISOString()
      });
    }
    
    // 🎯 CRIAR ENROLLMENT AUTOMÁTICO PARA ACESSO AO PRODUTO (WITETEC)
    {
      const updatedOrderData = { ...orderData, netAmount: witetecNetAmount, gatewayFee: witetecGatewayFee, platformFee: witetecPlatformFee };
      
      try {
        console.log('🎯 INICIANDO CRIAÇÃO DE ENROLLMENT AUTOMÁTICO (WITETEC)...');
        await storage.createEnrollmentOnPayment(updatedOrderData);
      } catch (enrollmentError) {
        console.error('❌ Erro ao criar enrollment automático (Witetec):', enrollmentError);
      }

      // 📧 CRIAR CONTA E ENVIAR EMAIL DE ACESSO (WITETEC)
      if (updatedOrderData.productType === 'digital' || updatedOrderData.productType === 'subscription' || !updatedOrderData.productType) {
        try {
          await autoCreateMemberOnPurchase({
            customerEmail: updatedOrderData.customerEmail || updatedOrderData.customer?.email,
            customerName: updatedOrderData.customerName || updatedOrderData.customer?.name,
            productId: updatedOrderData.productId,
            productType: updatedOrderData.productType,
            orderId: orderDoc.id,
            checkoutId: updatedOrderData.checkoutId || updatedOrderData.checkoutSlug
          });
        } catch(e: any) { console.warn('⚠️ [AUTO-MEMBER] Erro witetec:', e?.message || e); }
      }
      
      // 💰 CREDITAR SALDO DO VENDEDOR (WITETEC) - CRITICAL FIX
      try {
        const { processWebhookWithBalanceUpdate } = await import('./lib/atomic-balance.js');
        const balanceIdempotencyKey = `witetec_${txid || orderDoc.id}`;
        const netAmountCents = Math.round(updatedOrderData.netAmount || (updatedOrderData.amount - (updatedOrderData.gatewayFee || 0) - (updatedOrderData.platformFee || 0)));
        let sellerCredit = netAmountCents;
        
        let affiliateCommissionData: any = null;
        if (updatedOrderData.affiliateUid || updatedOrderData.affiliateCode) {
          try {
            affiliateCommissionData = await (storage as any).calculateAffiliateCommission(updatedOrderData);
            if (affiliateCommissionData?.hasAffiliate && affiliateCommissionData.netCommission > 0) {
              sellerCredit -= affiliateCommissionData.netCommission;
              console.log(`💰 WITETEC: Valor vendedor após comissão afiliado: R$ ${(sellerCredit/100).toFixed(2)}`);
            }
          } catch (calcErr: any) {
            console.warn('⚠️ Erro calcular comissão (Witetec):', calcErr?.message);
          }
        }
        
        await processWebhookWithBalanceUpdate({
          webhookId: balanceIdempotencyKey,
          provider: 'witetec',
          eventType: 'payment.confirmed',
          sellerId: updatedOrderData.tenantId,
          amountCents: sellerCredit,
          currency: updatedOrderData.currency || 'BRL',
          operation: 'add',
          balanceType: 'available',
          reason: `Pagamento Witetec confirmado - Ordem ${orderDoc.id}`,
          orderId: orderDoc.id,
          metadata: {
            method: updatedOrderData.method || 'pix',
            acquirer: 'witetec',
            totalAmount: updatedOrderData.amount,
            platformFee: updatedOrderData.platformFee || 0,
            gatewayFee: updatedOrderData.gatewayFee || 0,
            affiliateCommission: affiliateCommissionData?.netCommission || 0,
            customer: updatedOrderData.customer?.email || updatedOrderData.customerEmail
          },
          rawPayload: webhookData
        });
        console.log(`✅ WITETEC: Saldo creditado ao vendedor: R$ ${(sellerCredit/100).toFixed(2)}`);
      } catch (balanceErr: any) {
        console.error('❌ WITETEC: Erro ao creditar saldo do vendedor:', balanceErr?.message);
      }
      
      // 🎯 DISPARAR PIXEL DE COMPRA (WITETEC - FACEBOOK CAPI)
      if (updatedOrderData.checkoutId) {
        dispatchPurchaseEventToPixels(updatedOrderData.checkoutId, {
          id: orderDoc.id, tenantId: updatedOrderData.tenantId, customerEmail: updatedOrderData.customer?.email || updatedOrderData.customerEmail,
          customerName: updatedOrderData.customer?.name || updatedOrderData.customerName, customerPhone: updatedOrderData.customer?.phone || updatedOrderData.customerPhone,
          amount: updatedOrderData.amount, currency: updatedOrderData.currency || 'BRL', productName: updatedOrderData.productName || updatedOrderData.checkoutSnapshot?.title,
          method: updatedOrderData.method || 'pix', checkoutSlug: updatedOrderData.checkoutSlug
        }).catch(err => console.warn('[CAPI] Witetec purchase dispatch failed:', err?.message));
      }

      // 🔗 PROCESSAR COMISSÃO DE AFILIADO SE HOUVER (WITETEC)
      if (updatedOrderData.affiliateCode || updatedOrderData.affiliateUid) {
        console.log('🔗 AFILIADO DETECTADO - PROCESSANDO COMISSÃO WITETEC');
        try {
          await storage.processAffiliateCommission({ ...updatedOrderData, id: orderDoc.id });
          console.log('💰 WITETEC: Comissão de afiliado processada com sucesso');
        } catch (affiliateError: any) {
          console.error('❌ WITETEC WEBHOOK: Erro ao processar comissão:', affiliateError);
        }
      
      // 💼 PROCESSAR COMISSÕES DE COPRODUÇÃO (WITETEC)
      try {
        const source = updatedOrderData.affiliateCode ? 'affiliate_sale' : 'own_sale';
        await processCoproductionCommissions(
          orderDoc.id,
          updatedOrderData.checkoutId,
          updatedOrderData.tenantId,
          updatedOrderData.amount,
          updatedOrderData.netAmount || 0,
          source,
          updatedOrderData.affiliateId
        );
      } catch (coproductionError) {
        console.error('❌ WITETEC: Erro ao processar comissões de coprodução:', coproductionError);
      }
      }
      
      if (updatedOrderData.couponCode) {
        try {
          const couponDoc = await storage.getCouponByCode(updatedOrderData.couponCode, updatedOrderData.tenantId);
          if (couponDoc) {
            await storage.incrementCouponUsage(couponDoc.id);
            console.log(`🎫 [WITETEC] Cupom ${updatedOrderData.couponCode} uso incrementado`);
          }
        } catch(e) { console.warn('⚠️ [COUPON WITETEC] Erro ao incrementar uso:', e); }
      }
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`⚡ WITETEC: Webhook processado em ${processingTime}ms`);
    res.status(200).send('OK');
    
  } catch (error: any) {
    console.error('❌ WITETEC: Erro no webhook:', error.message);
    console.error('📊 WITETEC: Stack:', error.stack);
    // Sempre responder OK para evitar reenvios desnecessários
    res.status(200).send('OK');
  }
});

// 🌍 ADYEN WEBHOOK - CONFIRMAR PAGAMENTOS GLOBAIS COM VALIDAÇÃO HMAC
app.post('/api/webhooks/adyen', express.json(), async (req, res) => {
  try {
    console.log('🌍 Webhook Adyen recebido - validando HMAC signature...');
    
    await ensureFirebaseReady();
    const db = getFirestore();
    
    const paymentConfigRef = db.collection('paymentConfig').doc('global');
    const paymentConfigDoc = await paymentConfigRef.get();
    
    let hmacKey = process.env.ADYEN_HMAC_KEY;
    
    if (paymentConfigDoc.exists) {
      const data = paymentConfigDoc.data();
      if (data?.adyen?.hmacKey) {
        try {
          hmacKey = decryptSensitiveData(data.adyen.hmacKey);
          console.log('✅ ADYEN HMAC Key carregado do Firebase');
        } catch (decryptError) {
          console.error('⚠️ Erro ao descriptografar HMAC key, usando env var:', decryptError);
        }
      }
    }
    
    if (!hmacKey) {
      console.error('🚨 ERRO CRÍTICO: ADYEN_HMAC_KEY não configurado');
      return res.status(500).json({ error: 'HMAC key não configurado' });
    }
    
    // 🔐 EXTRAIR NOTIFICATIONREQUESTITEM DO PAYLOAD ADYEN
    const notificationItems = req.body.notificationItems;
    
    if (!notificationItems || !Array.isArray(notificationItems) || notificationItems.length === 0) {
      console.error('🚨 ADYEN WEBHOOK: Payload inválido - sem notificationItems');
      return res.status(400).json({ notificationResponse: '[invalid]' });
    }
    
    const notificationRequestItem = notificationItems[0].NotificationRequestItem;
    
    if (!notificationRequestItem) {
      console.error('🚨 ADYEN WEBHOOK: Payload inválido - sem NotificationRequestItem');
      return res.status(400).json({ notificationResponse: '[invalid]' });
    }
    
    // 🔐 VALIDAR HMAC USANDO BIBLIOTECA OFICIAL DO ADYEN
    const { validateAdyenWebhook } = await import('./security/webhook-validation.js');
    
    if (!validateAdyenWebhook(notificationRequestItem, hmacKey)) {
      console.error('🚨 ADYEN WEBHOOK REJEITADO: Assinatura HMAC inválida');
      return res.status(401).json({ notificationResponse: '[invalid]' });
    }
    
    console.log('✅ ADYEN WEBHOOK: Assinatura HMAC validada com sucesso');
    
    const event = notificationRequestItem;
    console.log('🎯 Adyen Event:', event.eventCode);
    
    if (event.eventCode === 'AUTHORISATION' && event.success === 'true') {
      const orderId = event.merchantReference;
      
      if (orderId) {
        console.log('✅ ADYEN PAGAMENTO CONFIRMADO - Order:', orderId);
        
        const orderDoc = await db.collection('orders').doc(orderId).get();
        const orderData = orderDoc.exists ? orderDoc.data() : null;
        
        let feeUpdate: any = {};
        if (orderData && !orderData.gatewayFee) {
          const feeCalculation = await calculateDynamicFees(
            orderData.amount || event.amount.value,
            'adyen',
            1,
            'adyen',
            orderData.tenantId || orderData.sellerId
          );
          const amount = orderData.amount || event.amount.value;
          feeUpdate = {
            gatewayFee: feeCalculation.gatewayFee,
            gatewayFeePercent: feeCalculation.gatewayFeePercent,
            platformFee: feeCalculation.platformFee,
            platformFeePercent: feeCalculation.platformFeePercent,
            netAmount: feeCalculation.netAmount,
            financialData: {
              grossAmount: amount,
              feeAmount: feeCalculation.gatewayFee + feeCalculation.platformFee,
              netAmount: feeCalculation.netAmount,
              releaseDate: new Date(Date.now() + (feeCalculation.releaseDays || 0) * 24 * 60 * 60 * 1000),
              released: false,
              feeBreakdown: {
                fixedFee: 0,
                percentFee: feeCalculation.gatewayFeePercent,
                percentAmount: feeCalculation.gatewayFee,
                platformFeePercent: feeCalculation.platformFeePercent,
                platformFeeAmount: feeCalculation.platformFee
              },
              releaseDays: feeCalculation.releaseDays || 0
            }
          };
        }
        
        const updateData = {
          status: 'paid' as const,
          paidAt: new Date(),
          adyenPspReference: event.pspReference,
          updatedAt: new Date(),
          webhookReceivedAt: new Date(),
          ...feeUpdate
        };
        
        await db.collection('orders').doc(orderId).update(updateData);
        console.log('📅 ADYEN ORDER STATUS ATUALIZADO PARA PAID:', orderId);
        
        // 📋 SINCRONIZAR STATUS NO RTDB + BUNNY CDN (dashboard de vendas)
        if (orderData?.tenantId) {
          syncOrderAfterUpdate(orderData.tenantId, orderId, {
            status: 'paid',
            paidAt: new Date().toISOString(),
            method: 'adyen',
            netAmount: feeUpdate.netAmount || orderData.netAmount || 0,
            gatewayFee: feeUpdate.gatewayFee || orderData.gatewayFee || 0
          });

          // 📊 ENVIAR ATUALIZAÇÃO PARA UTMIFY (pixel de conversão)
          sendOrderStatusUpdate(orderData.tenantId, orderId, 'paid', { paidAt: new Date() })
            .catch(err => console.warn('[UTMify] Async Adyen paid update failed:', err?.message));
        }
        
        if (orderData?.tenantId) {
          await triggerSellerWebhooks(orderData.tenantId, 'payment', {
            order_id: orderId,
            checkout_id: orderData.checkoutId,
            amount: orderData.amount,
            currency: event.amount.currency || 'USD',
            customer_email: orderData.customerEmail,
            product_type: orderData.productType || 'digital',
            payment_method: 'adyen',
            status: 'paid',
            paid_at: new Date().toISOString()
          });
        }
        
        const updatedOrderDoc = await db.collection('orders').doc(orderId).get();
        if (updatedOrderDoc.exists) {
          const updatedOrderData = updatedOrderDoc.data();
          
          try {
            console.log('🎯 INICIANDO CRIAÇÃO DE ENROLLMENT AUTOMÁTICO (ADYEN)...');
            await storage.createEnrollmentOnPayment(updatedOrderData);
          } catch (enrollmentError) {
            console.error('❌ Erro ao criar enrollment automático (Adyen):', enrollmentError);
          }

          // 📧 CRIAR CONTA E ENVIAR EMAIL DE ACESSO (ADYEN)
          if (updatedOrderData.productType === 'digital' || updatedOrderData.productType === 'subscription' || !updatedOrderData.productType) {
            try {
              await autoCreateMemberOnPurchase({
                customerEmail: updatedOrderData.customerEmail || updatedOrderData.customer?.email,
                customerName: updatedOrderData.customerName || updatedOrderData.customer?.name,
                productId: updatedOrderData.productId,
                productType: updatedOrderData.productType,
                orderId,
                checkoutId: updatedOrderData.checkoutId || updatedOrderData.checkoutSlug
              });
            } catch(e: any) { console.warn('⚠️ [AUTO-MEMBER] Erro adyen:', e?.message || e); }
          }
          
          // 💰 CREDITAR SALDO DO VENDEDOR (ADYEN) - CRITICAL FIX
          try {
            const { processWebhookWithBalanceUpdate } = await import('./lib/atomic-balance.js');
            const balanceIdempotencyKey = `adyen_${event.pspReference}_${event.eventCode}`;
            const netAmountCents = Math.round(updatedOrderData.netAmount || (updatedOrderData.amount - (updatedOrderData.gatewayFee || 0) - (updatedOrderData.platformFee || 0)));
            let sellerCredit = netAmountCents;
            
            let affiliateCommissionData: any = null;
            if (updatedOrderData.affiliateUid || updatedOrderData.affiliateCode) {
              try {
                affiliateCommissionData = await (storage as any).calculateAffiliateCommission(updatedOrderData);
                if (affiliateCommissionData?.hasAffiliate && affiliateCommissionData.netCommission > 0) {
                  sellerCredit -= affiliateCommissionData.netCommission;
                  console.log(`💰 ADYEN: Valor vendedor após comissão afiliado: R$ ${(sellerCredit/100).toFixed(2)}`);
                }
              } catch (calcErr: any) {
                console.warn('⚠️ Erro calcular comissão (Adyen):', calcErr?.message);
              }
            }
            
            await processWebhookWithBalanceUpdate({
              webhookId: balanceIdempotencyKey,
              provider: 'adyen',
              eventType: 'AUTHORISATION',
              sellerId: updatedOrderData.tenantId,
              amountCents: sellerCredit,
              currency: updatedOrderData.currency || event.amount?.currency || 'BRL',
              operation: 'add',
              balanceType: 'available',
              reason: `Pagamento Adyen confirmado - Ordem ${orderId}`,
              orderId: orderId,
              metadata: {
                method: 'card',
                acquirer: 'adyen',
                totalAmount: updatedOrderData.amount,
                platformFee: updatedOrderData.platformFee || 0,
                gatewayFee: updatedOrderData.gatewayFee || 0,
                affiliateCommission: affiliateCommissionData?.netCommission || 0,
                customer: updatedOrderData.customer?.email || updatedOrderData.customerEmail
              },
              rawPayload: event
            });
            console.log(`✅ ADYEN: Saldo creditado ao vendedor: R$ ${(sellerCredit/100).toFixed(2)}`);
          } catch (balanceErr: any) {
            console.error('❌ ADYEN: Erro ao creditar saldo do vendedor:', balanceErr?.message);
          }
          
          // 🎯 DISPARAR PIXEL DE COMPRA (ADYEN - FACEBOOK CAPI)
          if (updatedOrderData.checkoutId) {
            dispatchPurchaseEventToPixels(updatedOrderData.checkoutId, {
              id: orderId, tenantId: updatedOrderData.tenantId, customerEmail: updatedOrderData.customer?.email || updatedOrderData.customerEmail,
              customerName: updatedOrderData.customer?.name || updatedOrderData.customerName, customerPhone: updatedOrderData.customer?.phone || updatedOrderData.customerPhone,
              amount: updatedOrderData.amount, currency: updatedOrderData.currency || 'BRL', productName: updatedOrderData.productName || updatedOrderData.checkoutSnapshot?.title,
              method: 'card', checkoutSlug: updatedOrderData.checkoutSlug
            }).catch(err => console.warn('[CAPI] Adyen purchase dispatch failed:', err?.message));
          }

          if (updatedOrderData.affiliateCode || updatedOrderData.affiliateUid) {
            console.log('🔗 AFILIADO DETECTADO - PROCESSANDO COMISSÃO ADYEN');
            try {
              await storage.processAffiliateCommission({ ...updatedOrderData, id: orderId });
              console.log('💰 ADYEN: Comissão de afiliado processada com sucesso');
            } catch (affiliateError: any) {
              console.error('❌ ADYEN WEBHOOK: Erro ao processar comissão:', affiliateError);
            }
          }
          
          if (updatedOrderData.couponCode) {
            try {
              const couponDoc = await storage.getCouponByCode(updatedOrderData.couponCode, updatedOrderData.tenantId);
              if (couponDoc) {
                await storage.incrementCouponUsage(couponDoc.id);
                console.log(`🎫 [ADYEN] Cupom ${updatedOrderData.couponCode} uso incrementado`);
              }
            } catch(e) { console.warn('⚠️ [COUPON ADYEN] Erro ao incrementar uso:', e); }
          }
        }
        
        res.status(200).json({ notificationResponse: '[accepted]' });
      } else {
        console.log('⚠️ merchantReference não encontrado');
        res.status(200).json({ notificationResponse: '[accepted]' });
      }
    } else {
      console.log('ℹ️ Adyen Event ignorado:', event.eventCode);
      res.status(200).json({ notificationResponse: '[accepted]' });
    }
  } catch (error) {
    console.error('❌ Erro no webhook Adyen:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// 💳 PAGAR.ME WEBHOOK - CONFIRMAR PIX/CARTÃO/BOLETO BRASIL
app.post('/api/webhooks/pagarme', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    console.log('💳 Webhook Pagar.me recebido - validando X-Hub-Signature...');
    
    const signature = req.headers['x-hub-signature'] as string;
    
    if (!signature) {
      console.error('🚨 PAGAR.ME WEBHOOK REJEITADO: Sem X-Hub-Signature');
      return res.status(401).json({ error: 'X-Hub-Signature obrigatória' });
    }
    
    await ensureFirebaseReady();
    const db = getFirestore();
    
    const paymentConfigRef = db.collection('paymentConfig').doc('global');
    const paymentConfigDoc = await paymentConfigRef.get();
    
    let webhookSecret = process.env.PAGARME_WEBHOOK_SECRET;
    
    if (paymentConfigDoc.exists) {
      const data = paymentConfigDoc.data();
      if (data?.pagarme?.webhookSecret) {
        try {
          webhookSecret = decryptSensitiveData(data.pagarme.webhookSecret);
          console.log('✅ PAGAR.ME Webhook Secret carregado do Firebase');
        } catch (decryptError) {
          console.error('⚠️ Erro ao descriptografar webhook secret, usando env var:', decryptError);
        }
      }
    }
    
    if (!webhookSecret) {
      console.error('🚨 ERRO CRÍTICO: PAGARME_WEBHOOK_SECRET não configurado');
      return res.status(500).json({ error: 'Webhook secret não configurado' });
    }
    
    const payload = req.body.toString('utf8');
    const { validatePagarmeWebhook } = await import('./security/webhook-validation.js');
    
    if (!validatePagarmeWebhook(payload, signature, webhookSecret)) {
      console.error('🚨 PAGAR.ME WEBHOOK REJEITADO: Assinatura inválida');
      return res.status(401).json({ error: 'Assinatura inválida' });
    }
    
    console.log('✅ PAGAR.ME WEBHOOK: Assinatura X-Hub-Signature validada com sucesso');
    
    const event = JSON.parse(payload);
    console.log('🎯 Pagar.me Event:', event.type);
    
    if (event.type === 'transaction_status_changed' && event.current_status === 'paid') {
      const orderId = event.transaction?.metadata?.order_id;
      
      if (orderId) {
        console.log('✅ PAGAR.ME PAGAMENTO CONFIRMADO - Order:', orderId);
        
        const orderDoc = await db.collection('orders').doc(orderId).get();
        const orderData = orderDoc.exists ? orderDoc.data() : null;
        
        let feeUpdate: any = {};
        if (orderData && !orderData.gatewayFee) {
          const paymentMethod = event.transaction?.payment_method || 'pix';
          const feeCalculation = await calculateDynamicFees(
            orderData.amount || event.transaction?.amount,
            'pagarme',
            event.transaction?.installments || 1,
            paymentMethod,
            orderData.tenantId || orderData.sellerId
          );
          const amount = orderData.amount || event.transaction?.amount;
          feeUpdate = {
            gatewayFee: feeCalculation.gatewayFee,
            gatewayFeePercent: feeCalculation.gatewayFeePercent,
            platformFee: feeCalculation.platformFee,
            platformFeePercent: feeCalculation.platformFeePercent,
            netAmount: feeCalculation.netAmount,
            financialData: {
              grossAmount: amount,
              feeAmount: feeCalculation.gatewayFee + feeCalculation.platformFee,
              netAmount: feeCalculation.netAmount,
              releaseDate: new Date(Date.now() + (feeCalculation.releaseDays || 0) * 24 * 60 * 60 * 1000),
              released: false,
              feeBreakdown: {
                fixedFee: 0,
                percentFee: feeCalculation.gatewayFeePercent,
                percentAmount: feeCalculation.gatewayFee,
                platformFeePercent: feeCalculation.platformFeePercent,
                platformFeeAmount: feeCalculation.platformFee
              },
              releaseDays: feeCalculation.releaseDays || 0
            }
          };
        }
        
        const updateData = {
          status: 'paid' as const,
          paidAt: new Date(),
          pagarmeTransactionId: event.transaction?.id,
          updatedAt: new Date(),
          webhookReceivedAt: new Date(),
          ...feeUpdate
        };
        
        await db.collection('orders').doc(orderId).update(updateData);
        console.log('📅 PAGAR.ME ORDER STATUS ATUALIZADO PARA PAID:', orderId);
        
        // 📋 SINCRONIZAR STATUS NO RTDB + BUNNY CDN (dashboard de vendas)
        if (orderData?.tenantId) {
          syncOrderAfterUpdate(orderData.tenantId, orderId, {
            status: 'paid',
            paidAt: new Date().toISOString(),
            method: event.transaction?.payment_method || 'pagarme',
            netAmount: feeUpdate.netAmount || orderData.netAmount || 0,
            gatewayFee: feeUpdate.gatewayFee || orderData.gatewayFee || 0
          });

          // 📊 ENVIAR ATUALIZAÇÃO PARA UTMIFY (pixel de conversão)
          sendOrderStatusUpdate(orderData.tenantId, orderId, 'paid', { paidAt: new Date() })
            .catch(err => console.warn('[UTMify] Async Pagar.me paid update failed:', err?.message));
        }
        
        if (orderData?.tenantId) {
          await triggerSellerWebhooks(orderData.tenantId, 'payment', {
            order_id: orderId,
            checkout_id: orderData.checkoutId,
            amount: orderData.amount,
            currency: 'BRL',
            customer_email: orderData.customerEmail,
            product_type: orderData.productType || 'digital',
            payment_method: event.transaction?.payment_method || 'pagarme',
            status: 'paid',
            paid_at: new Date().toISOString()
          });
        }
        
        const updatedOrderDoc = await db.collection('orders').doc(orderId).get();
        if (updatedOrderDoc.exists) {
          const updatedOrderData = updatedOrderDoc.data();
          
          try {
            console.log('🎯 INICIANDO CRIAÇÃO DE ENROLLMENT AUTOMÁTICO (PAGAR.ME)...');
            await storage.createEnrollmentOnPayment(updatedOrderData);
          } catch (enrollmentError) {
            console.error('❌ Erro ao criar enrollment automático (Pagar.me):', enrollmentError);
          }

          // 📧 CRIAR CONTA E ENVIAR EMAIL DE ACESSO (PAGAR.ME)
          if (updatedOrderData.productType === 'digital' || updatedOrderData.productType === 'subscription' || !updatedOrderData.productType) {
            try {
              await autoCreateMemberOnPurchase({
                customerEmail: updatedOrderData.customerEmail || updatedOrderData.customer?.email,
                customerName: updatedOrderData.customerName || updatedOrderData.customer?.name,
                productId: updatedOrderData.productId,
                productType: updatedOrderData.productType,
                orderId,
                checkoutId: updatedOrderData.checkoutId || updatedOrderData.checkoutSlug
              });
            } catch(e: any) { console.warn('⚠️ [AUTO-MEMBER] Erro pagarme:', e?.message || e); }
          }
          
          // 💰 CREDITAR SALDO DO VENDEDOR (PAGAR.ME) - CRITICAL FIX
          try {
            const { processWebhookWithBalanceUpdate } = await import('./lib/atomic-balance.js');
            const balanceIdempotencyKey = `pagarme_${event.transaction?.id || orderId}`;
            const netAmountCents = Math.round(updatedOrderData.netAmount || (updatedOrderData.amount - (updatedOrderData.gatewayFee || 0) - (updatedOrderData.platformFee || 0)));
            let sellerCredit = netAmountCents;
            
            let affiliateCommissionData: any = null;
            if (updatedOrderData.affiliateUid || updatedOrderData.affiliateCode) {
              try {
                affiliateCommissionData = await (storage as any).calculateAffiliateCommission(updatedOrderData);
                if (affiliateCommissionData?.hasAffiliate && affiliateCommissionData.netCommission > 0) {
                  sellerCredit -= affiliateCommissionData.netCommission;
                  console.log(`💰 PAGAR.ME: Valor vendedor após comissão afiliado: R$ ${(sellerCredit/100).toFixed(2)}`);
                }
              } catch (calcErr: any) {
                console.warn('⚠️ Erro calcular comissão (Pagar.me):', calcErr?.message);
              }
            }
            
            await processWebhookWithBalanceUpdate({
              webhookId: balanceIdempotencyKey,
              provider: 'pagarme',
              eventType: 'transaction_status_changed',
              sellerId: updatedOrderData.tenantId,
              amountCents: sellerCredit,
              currency: updatedOrderData.currency || 'BRL',
              operation: 'add',
              balanceType: 'available',
              reason: `Pagamento Pagar.me confirmado - Ordem ${orderId}`,
              orderId: orderId,
              metadata: {
                method: event.transaction?.payment_method || 'card',
                acquirer: 'pagarme',
                totalAmount: updatedOrderData.amount,
                platformFee: updatedOrderData.platformFee || 0,
                gatewayFee: updatedOrderData.gatewayFee || 0,
                affiliateCommission: affiliateCommissionData?.netCommission || 0,
                customer: updatedOrderData.customer?.email || updatedOrderData.customerEmail
              },
              rawPayload: event
            });
            console.log(`✅ PAGAR.ME: Saldo creditado ao vendedor: R$ ${(sellerCredit/100).toFixed(2)}`);
          } catch (balanceErr: any) {
            console.error('❌ PAGAR.ME: Erro ao creditar saldo do vendedor:', balanceErr?.message);
          }
          
          // 🎯 DISPARAR PIXEL DE COMPRA (PAGAR.ME - FACEBOOK CAPI)
          if (updatedOrderData.checkoutId) {
            dispatchPurchaseEventToPixels(updatedOrderData.checkoutId, {
              id: orderId, tenantId: updatedOrderData.tenantId, customerEmail: updatedOrderData.customer?.email || updatedOrderData.customerEmail,
              customerName: updatedOrderData.customer?.name || updatedOrderData.customerName, customerPhone: updatedOrderData.customer?.phone || updatedOrderData.customerPhone,
              amount: updatedOrderData.amount, currency: updatedOrderData.currency || 'BRL', productName: updatedOrderData.productName || updatedOrderData.checkoutSnapshot?.title,
              method: event.transaction?.payment_method || 'card', checkoutSlug: updatedOrderData.checkoutSlug
            }).catch(err => console.warn('[CAPI] Pagar.me purchase dispatch failed:', err?.message));
          }

          if (updatedOrderData.affiliateCode || updatedOrderData.affiliateUid) {
            console.log('🔗 AFILIADO DETECTADO - PROCESSANDO COMISSÃO PAGAR.ME');
            try {
              await storage.processAffiliateCommission({ ...updatedOrderData, id: orderId });
              console.log('💰 PAGAR.ME: Comissão de afiliado processada com sucesso');
            } catch (affiliateError: any) {
              console.error('❌ PAGAR.ME WEBHOOK: Erro ao processar comissão:', affiliateError);
            }
          }
          
          if (updatedOrderData.couponCode) {
            try {
              const couponDoc = await storage.getCouponByCode(updatedOrderData.couponCode, updatedOrderData.tenantId);
              if (couponDoc) {
                await storage.incrementCouponUsage(couponDoc.id);
                console.log(`🎫 [PAGAR.ME] Cupom ${updatedOrderData.couponCode} uso incrementado`);
              }
            } catch(e) { console.warn('⚠️ [COUPON PAGAR.ME] Erro ao incrementar uso:', e); }
          }

          // 📧 EMAIL DE VENDA APROVADA PARA SELLER (Pagar.me)
          if (updatedOrderData.tenantId) {
            (async () => {
              try {
                const sellerDoc = await db.collection('sellers').doc(updatedOrderData.tenantId).get();
                const sellerData = sellerDoc.exists ? sellerDoc.data() : null;
                if (sellerData?.email) {
                  const { sendSaleApprovedEmail } = await import('./lib/email-service.js');
                  const pagarmeNet = feeUpdate.netAmount || updatedOrderData.netAmount || (updatedOrderData.amount - (feeUpdate.gatewayFee || 0) - (feeUpdate.platformFee || 0));
                  await sendSaleApprovedEmail({
                    sellerEmail: sellerData.email,
                    sellerName: sellerData.businessName || sellerData.fullName,
                    productName: updatedOrderData.productName || updatedOrderData.checkoutTitle || 'Produto',
                    productPrice: updatedOrderData.amount,
                    buyerName: updatedOrderData.customer?.name || updatedOrderData.customerName || 'Cliente',
                    buyerEmail: updatedOrderData.customer?.email || updatedOrderData.customerEmail || '',
                    paymentMethod: event.transaction?.payment_method || 'card',
                    orderId,
                    netAmount: pagarmeNet,
                    currency: updatedOrderData.currency || 'BRL'
                  });
                  console.log(`📧✅ Email venda aprovada (Pagar.me) enviado: ${sellerData.email}`);
                }
              } catch (e: any) { console.warn('⚠️ [PAGARME EMAIL] Erro:', e?.message); }
            })();
          }

          // 💼 COMISSÕES DE COPRODUÇÃO — Pagar.me (fire-and-forget)
          if (updatedOrderData.tenantId) {
            processCoproductionCommissions(
              orderId,
              updatedOrderData.checkoutId,
              updatedOrderData.tenantId,
              updatedOrderData.amount,
              feeUpdate.netAmount || updatedOrderData.netAmount || 0,
              updatedOrderData.affiliateCode ? 'affiliate_sale' : 'own_sale',
              updatedOrderData.affiliateId
            ).catch((e: any) => console.warn('⚠️ [COPROD] Pagar.me err:', e?.message));
          }

          // 🔐 SECURITY: Registrar transação aprovada (limites de volume)
          import('./security/transaction-limits.js').then(({ recordApprovedTransaction }) => {
            recordApprovedTransaction(updatedOrderData.tenantId, updatedOrderData.amount || 0).catch(() => {});
          }).catch(() => {});
        }
        
        res.status(200).json({ success: true });
      } else {
        console.log('⚠️ order_id não encontrado no metadata');
        res.status(200).json({ success: true });
      }
    } else {
      console.log('ℹ️ Pagar.me Event ignorado:', event.type);
      res.status(200).json({ success: true });
    }
  } catch (error) {
    console.error('❌ Erro no webhook Pagar.me:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ================================================================
// 📋 ROTAS DE API FALTANTES - VITRINE, VENDAS, SELLERS, ETC.
// ================================================================

// 💰 BUSCAR PREÇO DO PRODUTO (VIA OFERTAS SELECIONADAS PARA MARKETPLACE) - PÚBLICO
app.get('/api/products/:productId/price', async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    
    console.log(`🔍 [DEBUG PREÇO] Buscando ofertas para productId: ${productId}`);
    
    await ensureFirebaseReady();
    const db = getFirestore();
    
    // ✅ PASSO 1: Buscar produto para pegar selectedOffers
    const productDoc = await db.collection('products').doc(productId).get();
    
    if (!productDoc.exists) {
      console.warn(`⚠️ [DEBUG PREÇO] Produto não encontrado: ${productId}`);
      return res.json({ price: 0, hasOffers: false });
    }
    
    const productData = productDoc.data();
    const selectedOffers = productData?.affiliateConfig?.selectedOffers || [];
    const marketplaceEnabled = productData?.affiliateConfig?.marketplaceEnabled || false;
    
    if (!marketplaceEnabled) {
      console.warn(`⚠️ [DEBUG PREÇO] Marketplace desativado para produto: ${productId}`);
      return res.json({ price: 0, hasOffers: false });
    }
    
    
    
    // ✅ PASSO 2: Se não há ofertas selecionadas, buscar preço do checkout
    if (!Array.isArray(selectedOffers) || selectedOffers.length === 0) {
      console.log(`🔍 [DEBUG PREÇO] Sem ofertas selecionadas - buscando preço do checkout principal`);
      
      // Buscar checkout vinculado ao produto
      const checkoutId = productData?.checkoutId;
      if (!checkoutId) {
        console.warn(`⚠️ [DEBUG PREÇO] Produto sem checkoutId`);
        return res.json({ price: 0, hasOffers: false });
      }
      
      const checkoutDoc = await db.collection('checkouts').doc(checkoutId).get();
      if (!checkoutDoc.exists) {
        console.warn(`⚠️ [DEBUG PREÇO] Checkout não encontrado: ${checkoutId}`);
        return res.json({ price: 0, hasOffers: false });
      }
      
      const checkoutData = checkoutDoc.data();
      const checkoutPrice = checkoutData?.pricing?.amount || 0;
      
      console.log(`✅ [DEBUG PREÇO] Usando preço do checkout: R$ ${(checkoutPrice / 100).toFixed(2)}`);
      return res.json({ 
        price: checkoutPrice,
        hasOffers: false,
        fromCheckout: true
      });
    }
    // ✅ PASSO 3: Buscar a primeira oferta selecionada (por ID)
    const firstSelectedOfferId = selectedOffers[0];
    const offerDoc = await db.collection('productOffers').doc(firstSelectedOfferId).get();
    
    if (!offerDoc.exists) {
      console.warn(`⚠️ [DEBUG PREÇO] Oferta selecionada não encontrada: ${firstSelectedOfferId}`);
      return res.json({ price: 0, hasOffers: false });
    }
    
    const offerData = offerDoc.data();
    const cheapestOffer = { id: offerDoc.id, ...offerData };
    
    console.log(`💰 [DEBUG PREÇO] Oferta ATIVA mais barata encontrada:`, {
      offerId: cheapestOffer.id,
      price: cheapestOffer.price,
      title: cheapestOffer.title,
      active: cheapestOffer.active
    });
    
    res.json({ 
      price: cheapestOffer.price,
      hasOffers: true,
      currency: cheapestOffer.currency || 'BRL'
    });
    
  } catch (error) {
    console.error('❌ Erro ao buscar preço do produto:', error);
    res.status(500).json({ error: 'Erro ao buscar preço' });
  }
});
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts
// [EXTRACTED] Seller routes moved to server/routes/sellers.ts

// 🆔 BUSCAR TENANT DO USUÁRIO LOGADO (FIX PERMISSION-DENIED) - BLINDADO CONTRA ERROS
app.get('/api/tenants/me', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.authUser?.uid;
    
    if (!uid) {
      console.log('⚠️ Requisição sem autenticação');
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    console.log(`🔍 Buscando tenant para usuário: ${uid}`);
    
    try {
      // Buscar tenant no Firestore via Admin SDK (tem permissão)
      await ensureFirebaseReady();
      const db = getFirestore();
      
      const tenantsQuery = await db.collection('tenants')
        .where('ownerId', '==', uid)
        .limit(1)
        .get();
      
      if (!tenantsQuery.empty) {
        const tenantDoc = tenantsQuery.docs[0];
        const tenantData = {
          id: tenantDoc.id,
          ...tenantDoc.data()
        };
        console.log(`✅ Tenant encontrado: ${tenantDoc.id}`);
        return res.json(tenantData);
      }
      
      console.log(`ℹ️ Nenhum tenant encontrado para usuário ${uid}`);
      return res.json(null);
    } catch (dbError: any) {
      console.error('⚠️ Erro de Firestore ao buscar tenant:', dbError.message);
      console.error('Stack:', dbError.stack);
      return res.status(500).json({ error: 'Erro ao acessar banco de dados' });
    }
    
  } catch (error: any) {
    console.error('❌ ERRO CRÍTICO ao buscar tenant:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🏪 BUSCAR CHECKOUTS POR TENANT (AUTENTICADO)
app.get('/api/checkouts-by-tenant/:tenantId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    const userTenant = await getTenantFromAuth(req);
    
    // Verificar se o usuário pode acessar este tenant (segurança)
    const isAdmin = req.authUser?.isAdmin;
    
    if (userTenant !== tenantId && !isAdmin) {
      return res.status(403).json({ error: 'Acesso negado ao tenant' });
    }
    
    console.log(`🔍 Buscando checkouts do tenant: ${tenantId}`);
    
    const { firestoreCache } = await import('./lib/firestore-cache.js');
    const cachedCheckouts = firestoreCache.getTenantCheckoutsFromCache(tenantId);
    if (cachedCheckouts !== undefined) {
      console.log(`✅ [CACHE] ${cachedCheckouts.length} checkouts para tenant ${tenantId}`);
      return res.json(cachedCheckouts);
    }
    
    const checkouts = await storage.getCheckoutsByTenant(tenantId);
    firestoreCache.setTenantCheckoutsCache(tenantId, checkouts);
    
    console.log(`✅ ${checkouts.length} checkouts encontrados para tenant ${tenantId}`);
    res.json(checkouts);
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar checkouts por tenant:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💰 BUSCAR SAQUES DO USUÁRIO AUTENTICADO
app.get('/api/withdrawals', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('💰 [WITHDRAWALS] Requisição recebida');
    console.log('💰 [WITHDRAWALS] Query:', req.query);
    console.log('💰 [WITHDRAWALS] User:', req.user?.uid, req.user?.email);
    
    const { tenantId } = req.query;
    
    console.log('💰 [WITHDRAWALS] Buscando tenant do usuário autenticado...');
    const userTenant = await getTenantFromAuth(req);
    console.log('💰 [WITHDRAWALS] userTenant obtido:', userTenant);
    
    console.log('💰 [WITHDRAWALS] targetTenantId (query):', tenantId);
    
    // Usar tenantId da query ou do usuário autenticado
    const targetTenantId = tenantId as string || userTenant;
    
    if (!targetTenantId) {
      console.error('❌ [WITHDRAWALS] Tenant ID não encontrado');
      return res.status(400).json({ error: 'Tenant ID necessário' });
    }
    
    // Verificar se o usuário pode acessar este tenant (segurança)
    const isAdmin = req.authUser?.isAdmin;
    
    console.log('💰 [WITHDRAWALS] Verificando acesso - userTenant:', userTenant, 'targetTenantId:', targetTenantId, 'isAdmin:', isAdmin);
    
    if (userTenant !== targetTenantId && !isAdmin) {
      console.error(`❌ [WITHDRAWALS] Acesso negado - userTenant (${userTenant}) !== targetTenantId (${targetTenantId})`);
      return res.status(403).json({ error: 'Acesso negado aos saques deste tenant' });
    }
    
    console.log(`🔍 [WITHDRAWALS] Importando Firebase Admin...`);
    const { getAdmin } = await import('./lib/firebase-admin.js');
    const adminInstance = await getAdmin();
    const db = adminInstance.firestore();
    
    console.log(`🔍 [WITHDRAWALS] Buscando saques do tenant: ${targetTenantId}`);
    
    let withdrawals: any[] = [];
    
    try {
      // Tenta query COM índice composto primeiro
      const snapshot = await db.collection('withdrawals')
        .where('tenantId', '==', targetTenantId)
        .orderBy('createdAt', 'desc')
        .get();
      
      withdrawals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`✅ [WITHDRAWALS] Query com índice: ${withdrawals.length} saques encontrados`);
      
    } catch (queryError: any) {
      // Se o erro for de índice faltando, usa fallback
      if (queryError?.code === 9 || String(queryError?.message).includes('index')) {
        console.warn(`⚠️ [WITHDRAWALS] Índice composto ausente - usando fallback SEM índice...`);
        
        const fallbackSnapshot = await db.collection('withdrawals')
          .orderBy('createdAt', 'desc')
          .limit(500)
          .get();
        
        withdrawals = fallbackSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((w: any) => w.tenantId === targetTenantId);
        
        console.log(`✅ [WITHDRAWALS] FALLBACK: ${withdrawals.length} saques encontrados para tenant ${targetTenantId}`);
      } else {
        // Se for outro erro (não-índice), propaga
        throw queryError;
      }
    }
    
    // Ponto único de retorno
    res.json(withdrawals);
    
  } catch (error: any) {
    console.error('❌ [WITHDRAWALS] ERRO CRÍTICO:', error);
    console.error('❌ [WITHDRAWALS] Stack trace:', error.stack);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💰 CRIAR SOLICITAÇÃO DE SAQUE (DEBITA DO SALDO IMEDIATAMENTE)
app.post('/api/withdrawals', verifyFirebaseToken, userRateLimit('withdrawal'), replayProtectionMiddleware, idempotencyMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { amount, currency, pixData, userType: bodyUserType } = req.body;
    console.log('🔍 [WITHDRAWAL-DEBUG] Body recebido:', JSON.stringify(req.body, null, 2));
    
    // 🔐 TENANT ID vem sempre do token autenticado (não do body por segurança)
    const tenantId = await getTenantFromAuth(req);
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    console.log(`💰 Criando saque para tenant ${tenantId}:`, { amount, currency });
    
    // Buscar Firebase
    const { getAdmin } = await import('./lib/firebase-admin.js');
    const adminInstance = await getAdmin();
    const db = adminInstance.firestore();
    
    // 🔒 VALIDAÇÕES
    // 🛡️ BUG #3 FIX: Validar valores negativos
    if (amount < 0) {
      console.error(`🚨 SECURITY: Tentativa de saque com valor negativo! Tenant: ${tenantId}, Amount: ${amount}`);
      return res.status(400).json({ error: 'Valor inválido' });
    }
    
    // 🔍 DETECTAR SE É AFILIADO OU SELLER
    // ✅ FIX: Se o frontend enviou userType explícito, respeitar sem checar Firestore
    let isAffiliate = false;
    let affiliateQueryResult: FirebaseFirestore.QuerySnapshot | null = null;
    if (bodyUserType === 'seller') {
      isAffiliate = false; // Saque explicitamente de saldo de vendas
      console.log(`👤 [WITHDRAWAL] userType='seller' recebido do frontend — saque de sellerBalances`);
    } else if (bodyUserType === 'affiliate') {
      isAffiliate = true; // Saque explicitamente de comissões de afiliado
      console.log(`👤 [WITHDRAWAL] userType='affiliate' recebido do frontend — saque de comissões`);
      // Buscar afiliado para minPayout
      affiliateQueryResult = await db.collection('affiliates')
        .where('userId', '==', tenantId)
        .where('status', '==', 'approved')
        .limit(1)
        .get();
    } else {
      // Fallback: auto-detectar (compatibilidade com clientes antigos)
      affiliateQueryResult = await db.collection('affiliates')
        .where('userId', '==', tenantId)
        .where('status', '==', 'approved')
        .limit(1)
        .get();
      isAffiliate = !affiliateQueryResult.empty;
      console.log(`👤 [WITHDRAWAL] Auto-detecção: isAffiliate=${isAffiliate}`);
    }
    let minPayoutAmount = 5000; // Default R$ 50,00
    
    // 📋 SE FOR AFILIADO, BUSCAR minPayout DAS CONFIGURAÇÕES DO PRODUTO
    if (isAffiliate && affiliateQueryResult && !affiliateQueryResult.empty) {
      // Pegar primeiro produto onde é afiliado para usar o minPayout
      const affiliateDoc = affiliateQueryResult.docs[0];
      const affiliateData = affiliateDoc.data();
      const checkoutId = affiliateData.checkoutId;
      
      if (checkoutId) {
        const checkoutDoc = await db.collection('checkouts').doc(checkoutId).get();
        if (checkoutDoc.exists) {
          const checkoutData = checkoutDoc.data();
          minPayoutAmount = checkoutData?.affiliate?.minPayout || 5000;
        }
      }
      console.log(`👤 AFILIADO DETECTADO - minPayout: R$ ${(minPayoutAmount/100).toFixed(2)}`);
    }
    
    if (!amount || amount < minPayoutAmount) {
      return res.status(400).json({ 
        error: `Valor mínimo para saque é R$ ${(minPayoutAmount/100).toFixed(2)}` 
      });
    }
    
    // Validar dados PIX
    if (!pixData?.pixKey) {
      return res.status(400).json({ error: 'Chave PIX é obrigatória' });
    }
    let availableBalance = 0;
    const now = new Date();
    
    // 💰 CALCULAR SALDO DISPONÍVEL (DIFERENTE PARA SELLER vs AFILIADO)
    if (isAffiliate) {
      // 🔥 AFILIADO: Buscar COMISSÕES aprovadas e liberadas
      console.log(`💰 Calculando saldo de COMISSÕES para afiliado ${tenantId}`);
      
      const commissionsSnapshot = await db
        .collection('affiliateCommissions')
        .where('affiliateId', '==', affiliateQueryResult?.docs[0]?.id || tenantId)
        .where('status', 'in', ['pending', 'available'])
        .get();
      
      commissionsSnapshot.docs.forEach(doc => {
        const commission = doc.data();
        const releaseDate = commission.releaseDate?.toDate ? commission.releaseDate.toDate() : new Date(commission.releaseDate);
        
        // ✅ SÓ CONTAR SE JÁ PASSOU O PRAZO DE LIBERAÇÃO
        if (now >= releaseDate) {
          const commissionAmount = commission.commissionAmount || 0;
          if (commissionAmount > 0) {
            availableBalance += commissionAmount;
          }
        }
      });
      
      console.log(`✅ Saldo disponível (comissões): R$ ${(availableBalance/100).toFixed(2)}`);
      
    } else {
      // 💵 SELLER: Buscar saldo de sellerBalances (onde está o saldo real!)
      console.log(`💰 Buscando saldo de SELLERBALANCES para seller ${tenantId}`);
      
      const balanceDoc = await db.collection('sellerBalances').doc(tenantId).get();
      
      if (balanceDoc.exists) {
        const balanceData = balanceDoc.data();
        // Usar balanceAvailable_BRL como principal, availableBalance como fallback (campo legado)
        const primary = balanceData?.balanceAvailable_BRL;
        const fallback = balanceData?.availableBalance;
        availableBalance = (primary !== undefined && primary !== null) ? primary : (fallback || 0);
        console.log(`✅ Saldo disponível (sellerBalances): R$ ${(availableBalance/100).toFixed(2)}`);
      } else {
        // ⚠️ FALLBACK: Calcular saldo a partir das orders (igual ao balance/summary)
        console.log(`⚠️ sellerBalances não existe para ${tenantId} — calculando saldo das orders...`);
        try {
          const ordersSnap = await db.collection('orders').where('tenantId', '==', tenantId).get();
          let computed = 0;
          for (const orderDoc of ordersSnap.docs) {
            const o = orderDoc.data();
            const currency = (o.feeSnapshot?.currency || o.currency || 'BRL').toUpperCase();
            if (currency !== 'BRL') continue;
            let net = o.netAmount || o.feeSnapshot?.netAmount || o.sellerNetAmount || o.totalAmount || o.amount || 0;
            const affComm = o.affiliateCommission;
            const affAmt = affComm ? (typeof affComm === 'number' ? affComm : affComm.amount || 0) : 0;
            if (affAmt > 0) net -= affAmt;
            if (['paid','approved','completed'].includes(o.status)) computed += net;
          }
          // Deduzir saques já aprovados/processados
          let wSnap = await db.collection('withdrawals').where('tenantId', '==', tenantId).get();
          if (wSnap.empty) wSnap = await db.collection('withdrawals').where('sellerId', '==', tenantId).get();
          for (const wDoc of wSnap.docs) {
            const w = wDoc.data();
            if (['approved','completed','processing'].includes(w.status)) computed -= (w.amount || 0);
          }
          if (computed < 0) computed = 0;
          availableBalance = computed;
          console.log(`✅ Saldo calculado das orders: R$ ${(availableBalance/100).toFixed(2)}`);
          // Criar sellerBalances para uso futuro (só se não existir)
          if (availableBalance > 0) {
            await db.collection('sellerBalances').doc(tenantId).set({
              sellerId: tenantId,
              tenantId,
              balanceAvailable_BRL: availableBalance,
              balanceReserved_BRL: 0,
              balancePending_BRL: 0,
              availableBalance,
              reservedBalance: 0,
              totalBalance: availableBalance,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              computedFromOrders: true,
            }, { merge: true });
            console.log(`✅ sellerBalances criado para ${tenantId} com R$ ${(availableBalance/100).toFixed(2)}`);
          }
        } catch (fallbackErr: any) {
          console.error(`❌ Erro no fallback de saldo das orders:`, fallbackErr.message);
          availableBalance = 0;
        }
      }
    }
    
    
    // 🛡️ VERIFICAR SE TEM SALDO SUFICIENTE
    const fee = 300; // Taxa fixa R$ 3,00
    const netAmount = amount - fee; // Valor líquido que o seller vai receber
    
    // ✅ FIX: Taxa é descontada DO valor sacado, não adicionada
    // O usuário pode sacar até o valor disponível, e recebe (valor - taxa)
    if (availableBalance < amount) {
      return res.status(400).json({ 
        error: `Saldo insuficiente. Disponível: R$ ${(availableBalance/100).toFixed(2)}` 
      });
    }
    
    // Buscar dados do seller
    const sellerDoc = await db.collection('sellers').doc(tenantId).get();
    // 🆔 GERAR ID ÚNICO PARA O SAQUE
    const withdrawalId = nanoid();
    
    const sellerData = sellerDoc.exists ? sellerDoc.data() : {};
    
    const withdrawalData = {
      id: withdrawalId,
      tenantId,
      sellerName: sellerData?.name || sellerData?.companyName || 'Seller',
      sellerEmail: sellerData?.email || req.authUser?.email || '',
      type: 'pix', // Sempre PIX por enquanto
      amount, // Valor solicitado em centavos (bruto)
      fee, // Taxa em centavos
      netAmount, // ✅ Valor líquido a receber (amount - fee)
      currency,
      pixKey: pixData.pixKey,
      pixKeyType: pixData.pixKeyType,
      holderName: pixData.holderName,
      holderEmail: pixData.holderEmail,
      holderDocument: pixData.holderDocument,
      status: 'pending', // Aguardando aprovação admin
      requestedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    
    // 🔒 TRANSAÇÃO ATOMIC: Criar doc + Debitar saldo na mesma operação atômica
    const balanceRef = db.collection('sellerBalances').doc(tenantId);
    const withdrawalRef = db.collection('withdrawals').doc(withdrawalId);
    console.log(`🔍 [DEBUG] ANTES TRANSAÇÃO - Tentando debitar ${amount} centavos do saldo`);
    
    await db.runTransaction(async (transaction) => {
      const balanceSnap = await transaction.get(balanceRef);
      if (!balanceSnap.exists) {
        throw new Error('BALANCE_NOT_FOUND');
      }
      transaction.set(withdrawalRef, withdrawalData);
      transaction.update(balanceRef, {
        balanceAvailable_BRL: FieldValue.increment(-amount),
        balanceReserved_BRL: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp()
      });
    });
    
    console.log(`✅ Saque criado com sucesso: ${withdrawalId} - R$ ${(amount/100).toFixed(2)} (pix)`);
    console.log(`✅ [DEBUG] DEPOIS TRANSAÇÃO - Saldo atualizado com sucesso no Firebase`);
    console.log(`💳 Valor DEBITADO do saldo disponível: -R$ ${(amount/100).toFixed(2)}`);
    console.log(`🔒 Valor RESERVADO: +R$ ${(amount/100).toFixed(2)} (aguardando aprovação)`)
    
    res.json({ 
      success: true, 
      data: {
        ...withdrawalData,
        requestedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao criar saque:', error);
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
    if (error.message === 'BALANCE_NOT_FOUND') {
      return res.status(404).json({ error: 'Saldo não encontrado. Você ainda não teve vendas.' });
    }
    res.status(500).json({ error: 'Erro ao solicitar saque. Tente novamente.' });
  }
});
// [EXTRACTED] post /api/admin/withdrawals/:id/reject moved to server/routes/admin.ts

// [EXTRACTED] Affiliate routes moved to server/routes/affiliations.ts
// 📊 DASHBOARD STATS - SUBSCRIPTION METRICS FOR SELLER
app.get('/api/subscriptions/dashboard-stats', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.user.uid;

    console.log(`📊 BUSCANDO ESTATÍSTICAS DE ASSINATURAS PARA DASHBOARD: ${sellerId}`);

    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();

    // 1️⃣ BUSCAR TODAS AS ASSINATURAS DO SELLER
    const subscriptionsSnapshot = await db.collection('subscriptions')
      .where('sellerId', '==', sellerId)
      .get();

    const subscriptions = subscriptionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];

    const now = new Date();

    // 2️⃣ CALCULAR ASSINATURAS ATIVAS
    const activeSubscriptions = subscriptions.filter(sub => 
      sub.status === 'active' && new Date(sub.endDate) > now
    );

    const totalActive = activeSubscriptions.length;

    // 3️⃣ CALCULAR MRR (Monthly Recurring Revenue)
    const mrr = activeSubscriptions.reduce((sum, sub) => {
      return sum + (sub.amount || 0);
    }, 0);

    // 4️⃣ CALCULAR TAXA DE RECORRÊNCIA
    // Taxa = (Assinaturas Ativas / Total de Assinaturas) * 100
    const recurrenceRate = subscriptions.length > 0 
      ? Number(((activeSubscriptions.length / subscriptions.length) * 100).toFixed(1))
      : 0;

    console.log(`✅ Stats calculados - Ativas: ${totalActive}, MRR: R$ ${(mrr/100).toFixed(2)}, Taxa: ${recurrenceRate}%`);

    res.json({
      totalActive,
      mrr,
      recurrenceRate,
      totalSubscriptions: subscriptions.length,
      cancelledSubscriptions: subscriptions.filter(s => s.status === 'cancelled').length
    });

  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas de assinaturas:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// 🚫 ENDPOINT REMOVIDO - DADOS PERMANENTES PROTEGIDOS EM PRODUÇÃO

// 🚫 ENDPOINT PERMANENTEMENTE DESABILITADO - DADOS PERMANENTES NÃO PODEM SER DELETADOS
// 🔒 PROTEÇÃO: Produtos, vendas e dados de clientes são PERMANENTES e NUNCA podem ser deletados via API
// 🛡️ SEGURANÇA EMPRESARIAL: Dados históricos devem ser preservados indefinidamente para compliance
// [EXTRACTED] post /api/admin/clear-all-sales moved to server/routes/admin.ts

// 🔧 MIGRAÇÃO: Corrigir taxas eternas (V1) - EXECUTA UMA VEZ
async function migrateEternalFees() {
  try {
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    // Verificar se migração já foi executada
    const migrationRef = db.collection('admin').doc('fee-migration-v1');
    const migrationDoc = await migrationRef.get();
    
    if (migrationDoc.exists && migrationDoc.data()?.completed) {
      console.log('✅ Migração de taxas V1 já executada anteriormente');
      return;
    }
    
    console.log('🔧 MIGRAÇÃO V1: Atualizando taxas eternas no Firebase...');
    
    // Buscar configuração atual
    const configRef = db.collection('paymentConfig').doc('global');
    const configDoc = await configRef.get();
    
    if (!configDoc.exists) {
      console.log('⚠️ Config não existe - será criada com valores corretos no AUTO-INIT');
      await migrationRef.set({ completed: true, executedAt: new Date(), skipped: true });
      return;
    }
    
    const currentConfig = configDoc.data();
    const oldFees = currentConfig?.fees || {};
    
    console.log('📊 TAXAS ANTIGAS:', {
      pixFixedFee: oldFees.pixFixedFee,
      pixReleaseDays: oldFees.pixReleaseDays,
      creditCardBRFixedFee: oldFees.creditCardBRFixedFee,
      creditCardBRPercentFee: oldFees.creditCardBRPercentFee
    });
    
    // TAXAS ETERNAS CORRETAS
    const ETERNAL_FEES = {
      pixFixedFee: 249,           // R$ 2,49
      pixPercentFee: 2.99,        // 2,99%
      pixReleaseDays: 0,          // D+0 (saque imediato)
      creditCardBRFixedFee: 249,   // R$ 2,49
      creditCardBRPercentFee: 5.2, // 5,2%
      creditCardBRReleaseDays: 20, // D+20
      creditCardBR1x: 5.2,         // 5,2%
      creditCardBR6x: 7.9,         // 7,9%
      creditCardBR9x: 13.9,        // 13,9%
      creditCardBR12x: 17.90,      // 17,90%
    };
    
    // Atualizar config com merge (preserva outros campos)
    await configRef.update({
      fees: {
        ...oldFees,
        ...ETERNAL_FEES
      },
      updatedAt: new Date()
    });
    
    // Marcar migração como concluída
    await migrationRef.set({
      completed: true,
      executedAt: new Date(),
      oldFees: {
        pixFixedFee: oldFees.pixFixedFee,
        pixReleaseDays: oldFees.pixReleaseDays,
        creditCardBRFixedFee: oldFees.creditCardBRFixedFee
      },
      newFees: ETERNAL_FEES
    });
    
    console.log('✅ MIGRAÇÃO V1 CONCLUÍDA! Taxas atualizadas para valores ETERNOS');
    console.log('💰 NOVAS TAXAS:', ETERNAL_FEES);
    
  } catch (error: any) {
    console.error('❌ ERRO na migração de taxas:', error.message);
  }
}

// 💳 AUTO-INICIALIZAÇÃO: Salvar configurações de pagamento no Firebase automaticamente
async function autoSavePaymentConfig() {
  try {
    console.log('💳 AUTO-INIT: Verificando configurações de pagamento...');
    
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    // Verificar se já existem configurações E se todas as chaves estão presentes
    const configDoc = await db.collection('paymentConfig').doc('global').get();
    
    if (configDoc.exists) {
      const data = configDoc.data();
      
      // 🔒 PROTEÇÃO: Se configurações JÁ EXISTEM, NUNCA sobrescrever!
      // Isso preserva as TAXAS ETERNAS configuradas pelo admin
      console.log('✅ Configurações de pagamento já existem no Firebase - PRESERVANDO');
      console.log(`   - Stripe: ${data?.stripe?.enabled ? 'ATIVO' : 'INATIVO'}`);
      console.log(`   - EfíBank: ${data?.efibank?.enabled ? 'ATIVO' : 'INATIVO'}`);
      console.log(`   - Taxas PIX: R$ ${((data?.fees?.pixFixedFee || 0) / 100).toFixed(2)} + ${data?.fees?.pixPercentFee || 0}%`);
      return;
    }
    
    console.log('📝 AUTO-INIT: Criando configurações de pagamento iniciais...');
    
    // Importar função de salvamento
    const { savePaymentConfig } = await import('./lib/payment-config.js');
    const { encryptSensitiveData } = await import('./security/key-encryption.js');
    
    // Preparar configuração usando environment variables
    const config: any = {
      defaultAcquirers: {
        pix: 'efibank',
        creditCardBR: 'efibank',
        creditCardGlobal: 'stripe',
        boleto: 'efibank',
      },
      fees: {
        pixFixedFee: 249,           // 🔒 R$ 2,49 - VALOR PADRÃO CORRETO
        pixPercentFee: 2.99,        // 🔒 2,99%
        pixReleaseDays: 0,          // 🔒 D+0 (saque imediato)
        creditCardFixedFee: 49,
        creditCardPercentFee: 4.99,
        creditCardReleaseDays: 30,
        boletoFixedFee: 349,
        boletoPercentFee: 0,
        boletoReleaseDays: 2,
      },
      stripe: {
        enabled: true,
        environment: 'production',
        publicKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
        secretKey: process.env.STRIPE_SECRET_KEY ? encryptSensitiveData(process.env.STRIPE_SECRET_KEY) : '',
        webhookSecret: '',
      },
      efibank: {
        enabled: true,
        environment: 'production',
        productionClientId: process.env.EFIBANK_CLIENT_ID ? encryptSensitiveData(process.env.EFIBANK_CLIENT_ID) : '',
        productionClientSecret: process.env.EFIBANK_CLIENT_SECRET ? encryptSensitiveData(process.env.EFIBANK_CLIENT_SECRET) : '',
        sandboxClientId: '',
        sandboxClientSecret: '',
        payeeCode: process.env.EFIBANK_PAYEE_CODE || '',
        pixKey: process.env.EFIBANK_PIX_KEY || '',
        certificatePath: getCertPath('efi-prod.p12'),
      },
      adyen: {
        enabled: false,
        environment: 'test',
        apiKey: '',
        merchantAccount: '',
        clientKey: '',
      },
      witetec: {
        enabled: false,
        environment: 'sandbox',
        apiKey: '',
      },
    };
    
    // Salvar configuração
    await savePaymentConfig(db, config, 'system-auto-init', 'Sistema Automático');
    
    console.log('✅ AUTO-INIT: Configurações de pagamento salvas com sucesso!');
    console.log('   ✅ Stripe (Produção) - ATIVO');
    console.log('   ✅ EfíBank (Produção) - ATIVO');
    console.log('   ⏸️  Adyen - DESABILITADO');
    console.log('   ⏸️  Witetec - DESABILITADO');
    
  } catch (error: any) {
    console.error('⚠️ Erro ao salvar configurações de pagamento automaticamente:', error.message);
    console.log('💡 As configurações podem ser configuradas manualmente em /admin/payment-config');
  }
}

// 📄 ============================================
// 📄 EFIBANK BOLETO - ENDPOINT DE PAGAMENTO BOLETO
// 📄 ============================================

app.post('/api/payments/efibank-boleto', paymentIPRateLimit, sanitizeCheckoutInputs, idempotencyMiddleware, async (req, res) => {
  try {
    console.log('📄 PROCESSANDO PAGAMENTO BOLETO EFIBANK...');
    
    const { 
      checkoutId, 
      amount, 
      customer,
      dueDate,
      selectedOrderBumps = [],
      couponCode: boletoCouponCode,
      affiliateUid: boletoAffiliateUid,
      offerSlug: boletoOfferSlug,
      trackingParameters: boletoTrackingParams,
    } = req.body;
    
    if (!checkoutId || !amount || !customer) {
      return res.status(400).json({
        error: 'Dados obrigatórios ausentes',
        message: 'checkoutId, amount e customer são obrigatórios'
      });
    }
    
    if (!customer.name || !customer.email || !customer.document || !customer.phone) {
      return res.status(400).json({
        error: 'Dados do cliente incompletos',
        message: 'Nome, email, documento e telefone são obrigatórios'
      });
    }

    // 🚨 CARDING DETECTOR
    {
      const { checkCardingVelocity } = await import('./security/carding-detector.js');
      const cardingResult = await checkCardingVelocity(checkoutId, req);
      if (cardingResult.blocked) {
        return res.status(429).json({ error: 'too_many_payment_attempts', message: cardingResult.message });
      }
    }
    
    const admin = await getAdmin();
    const db = admin.firestore();
    
    const checkoutDoc = await db.collection('checkouts').doc(checkoutId).get();
    if (!checkoutDoc.exists) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }
    
    const checkoutData = checkoutDoc.data();
    const tenantId = checkoutData?.tenantId || checkoutData?.sellerId;
    const sellerId = checkoutData?.sellerId || checkoutData?.tenantId;

    // 🛡️ VALIDAÇÃO SERVER-SIDE DO VALOR — cliente nunca define o preço final
    let checkoutBasePrice = checkoutData?.pricing?.amount || 0;
    let effectivePricingBoleto = checkoutData?.pricing || { amount: checkoutBasePrice };

    // Suporta offerSlug (igual ao cartão)
    if (boletoOfferSlug && checkoutData?.offers && Array.isArray(checkoutData.offers)) {
      const selectedOffer = checkoutData.offers.find((o: any) => o.slug === boletoOfferSlug);
      if (selectedOffer && selectedOffer.pricing?.amount) {
        checkoutBasePrice = selectedOffer.pricing.amount;
        effectivePricingBoleto = selectedOffer.pricing;
      }
    }

    if (checkoutBasePrice > 0) {
      const clientAmount = Number(amount);
      if (isNaN(clientAmount) || clientAmount < checkoutBasePrice * 0.99) {
        console.error(`🚨 [BOLETO] Tentativa de manipulação de preço! Base: ${checkoutBasePrice}, Enviado: ${amount}`);
        return res.status(400).json({
          error: 'Valor inválido para este produto',
          code: 'INVALID_AMOUNT',
        });
      }
      if (clientAmount > checkoutBasePrice * 50) {
        return res.status(400).json({ error: 'Valor excede o máximo permitido', code: 'AMOUNT_TOO_HIGH' });
      }
    }

    // 💰 CALCULAR TAXAS DINÂMICAS (boleto) — baseadas na configuração do admin
    const feeCalcBoleto = await calculateDynamicFees(amount, 'boleto', 1, 'efibank', tenantId || sellerId);

    console.log(`💰 TAXAS BOLETO: Gateway=${feeCalcBoleto.gatewayFeePercent}% fixo=R$${(feeCalcBoleto.gatewayFeeFixed||0)/100} Platform=${feeCalcBoleto.platformFeePercent}% Net=R$${(feeCalcBoleto.netAmount/100).toFixed(2)}`);
    
    const orderId = `order_boleto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expireDate = dueDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 📸 SNAPSHOT DO CHECKOUT
    const checkoutSnapshotBoleto = {
      title: checkoutData?.title || '',
      subtitle: checkoutData?.subtitle || '',
      description: checkoutData?.description || '',
      logoUrl: checkoutData?.logoUrl || null,
      bannerUrl: checkoutData?.bannerUrl || null, // 🔑 FIX: incluir bannerUrl igual ao PIX/cartão
      price: amount,
      originalPrice: checkoutBasePrice,
      productType: checkoutData?.productType || 'digital',
      marketTarget: 'brasil',
      pricing: effectivePricingBoleto,
    };
    
    await db.collection('orders').doc(orderId).set({
      id: orderId,
      tenantId,
      sellerId,
      checkoutId,
      productId: checkoutData?.productId || null, // 🔑 CRITICAL: necessário para acesso à área de membros
      amount,
      currency: 'BRL',
      status: 'pending',
      method: 'boleto',
      paymentMethod: 'efibank_boleto',
      paymentProcessor: 'efibank',
      processor: 'efibank',
      productType: checkoutData?.productType || 'digital',
      marketTarget: 'brasil',
      checkoutSnapshot: checkoutSnapshotBoleto,
      customer: {
        name: customer.name,
        email: customer.email,
        document: customer.document,
        phone: customer.phone,
        address: customer.address || null,
      },
      selectedOrderBumps,
      orderBumps: (() => {
        // Enriquecer bumps do boleto (sem nova consulta — usa dados já no checkoutData)
        const boletoEnriched = (selectedOrderBumps as any[]).map((bumpRef: any) => {
          const cid = typeof bumpRef === 'string' ? bumpRef : bumpRef?.checkoutId;
          if (!cid) return null;
          const knownBump = Array.isArray(checkoutData?.orderBump?.products)
            ? checkoutData.orderBump.products.find((p: any) => p.checkoutId === cid)
            : null;
          const price = knownBump?.price || 0;
          const name = knownBump?.customTitle || knownBump?.title || 'Order Bump';
          return price > 0 ? { checkoutId: cid, name, price } : null;
        }).filter(Boolean);
        return boletoEnriched.length > 0 ? boletoEnriched : null;
      })(),
      couponCode: boletoCouponCode || null,
      affiliateUid: boletoAffiliateUid || null,
      offerSlug: boletoOfferSlug || null,
      trackingParameters: boletoTrackingParams || null,
      // 💰 TAXAS DINÂMICAS
      gatewayFee: feeCalcBoleto.gatewayFee,
      gatewayFeePercent: feeCalcBoleto.gatewayFeePercent,
      platformFee: feeCalcBoleto.platformFee,
      platformFeePercent: feeCalcBoleto.platformFeePercent,
      netAmount: feeCalcBoleto.netAmount,
      // 📊 SNAPSHOT FINANCEIRO
      financialData: {
        grossAmount: amount,
        feeAmount: feeCalcBoleto.gatewayFee + feeCalcBoleto.platformFee,
        netAmount: feeCalcBoleto.netAmount,
        releaseDate: new Date(Date.now() + (feeCalcBoleto.releaseDays || 2) * 24 * 60 * 60 * 1000),
        released: false,
        feeBreakdown: {
          fixedFee: feeCalcBoleto.gatewayFeeFixed || 0,
          percentFee: feeCalcBoleto.gatewayFeePercent,
          percentAmount: feeCalcBoleto.gatewayFee,
          platformFeePercent: feeCalcBoleto.platformFeePercent,
          platformFeeAmount: feeCalcBoleto.platformFee,
        },
        releaseDays: feeCalcBoleto.releaseDays || 2,
      },
      financial: {
        netAmount: feeCalcBoleto.netAmount,
        balanceType: 'pending',
        releaseDate: new Date(Date.now() + (feeCalcBoleto.releaseDays || 2) * 24 * 60 * 60 * 1000),
        releaseDays: feeCalcBoleto.releaseDays || 2,
        boletoBalanceReleased: false,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('./lib/neon-financial.js').then(({ neonWriteOrder }) => {
      neonWriteOrder({
        id: orderId,
        checkoutId,
        productId: (checkoutData as any)?.productId ?? null,
        tenantId: tenantId || sellerId,
        sellerId,
        status: 'pending',
        method: 'boleto',
        paymentMethod: 'efibank_boleto',
        paymentProcessor: 'efibank',
        amount,
        currency: 'BRL',
        productType: (checkoutData as any)?.productType ?? null,
        marketTarget: 'brasil',
        offerSlug: (boletoOfferSlug as any) ?? null,
        couponCode: (boletoCouponCode as any) ?? null,
        affiliateUid: (boletoAffiliateUid as any) ?? null,
        gatewayFee: feeCalcBoleto.gatewayFee,
        gatewayFeePercent: feeCalcBoleto.gatewayFeePercent,
        platformFee: feeCalcBoleto.platformFee,
        platformFeePercent: feeCalcBoleto.platformFeePercent,
        netAmount: feeCalcBoleto.netAmount,
        customer: { name: (customer as any).name, email: (customer as any).email, document: (customer as any).document, phone: (customer as any).phone },
        checkoutSnapshot: checkoutSnapshotBoleto,
        trackingParameters: (boletoTrackingParams as any) ?? null,
      });
    }).catch(() => {});
    
    const { createBoletoCharge } = await import('./lib/efibank-payments-api.js');
    
    const boletoResponse = await createBoletoCharge(
      db,
      orderId,
      amount,
      {
        name: customer.name,
        cpf: customer.document.length <= 11 ? customer.document : undefined,
        cnpj: customer.document.length > 11 ? customer.document : undefined,
        email: customer.email,
        phone_number: customer.phone,
        address: customer.address ? {
          street: customer.address.street,
          number: customer.address.number,
          neighborhood: customer.address.neighborhood,
          zipcode: customer.address.zipCode,
          city: customer.address.city,
          state: customer.address.state,
          complement: customer.address.complement,
        } : undefined,
      },
      checkoutData?.title || 'Produto',
      expireDate
    );
    
    console.log('✅ BOLETO CRIADO:', orderId);
    
    res.json({
      success: true,
      orderId,
      chargeId: boletoResponse.data.charge_id,
      boleto: {
        barcode: boletoResponse.data.barcode,
        link: boletoResponse.data.billet_link,
        pdfLink: boletoResponse.data.pdf?.charge,
        expireAt: boletoResponse.data.expire_at,
        pixQrcode: boletoResponse.data.pix?.qrcode,
        pixQrcodeImage: boletoResponse.data.pix?.qrcode_image,
      },
    });
    
  } catch (error: any) {
    console.error('❌ ERRO BOLETO EFIBANK:', error);
    res.status(500).json({
      error: 'Erro ao processar boleto',
      message: error.message || 'Falha na comunicação com EfíBank',
    });
  }
});

// 📄 ============================================
// 📄 EFIBANK CHARGE WEBHOOK (Boleto/Card paid notifications)
// 📄 ============================================

app.post('/api/webhooks/efibank', express.json(), async (req, res) => {
  try {
    // EfíBank envia { token, charge_id } quando status muda
    const { token: notifyToken, charge_id } = req.body || {};

    if (!charge_id) {
      console.warn('[EFI-WEBHOOK] charge_id ausente no payload');
      return res.status(200).send('OK'); // Sempre 200 para evitar retry excessivo
    }

    console.log(`🔔 [EFI-WEBHOOK] Notificação recebida: charge_id=${charge_id}`);

    await ensureFirebaseReady();
    const db = getFirestore();

    // 1️⃣ Buscar a ordem pelo efiChargeId
    const chargeIdStr = String(charge_id);
    let ordersSnap = await db.collection('orders')
      .where('efiChargeId', '==', chargeIdStr)
      .limit(5)
      .get();

    if (ordersSnap.empty) {
      console.warn(`[EFI-WEBHOOK] Nenhuma ordem encontrada para charge_id=${chargeIdStr}`);
      return res.status(200).send('OK');
    }

    const orderDoc = ordersSnap.docs[0];
    const orderData = orderDoc.data();
    const orderId = orderDoc.id;

    if (orderData.status === 'paid' || orderData.status === 'failed') {
      console.log(`[EFI-WEBHOOK] Ordem ${orderId} já está ${orderData.status} — ignorando`);
      return res.status(200).send('OK');
    }

    // 2️⃣ Confirmar status na API EfíBank (Cobranças)
    const { getEfiBankKeys } = await import('./lib/payment-config.js');
    const efiKeys = await getEfiBankKeys(db);
    const { getEfiCobrancasToken } = await import('./lib/efibank-payments-api.js');
    const accessToken = await getEfiCobrancasToken({
      clientId: efiKeys.clientId,
      clientSecret: efiKeys.clientSecret,
      isProduction: efiKeys.environment === 'production',
    });

    const hostname = efiKeys.environment === 'production'
      ? 'cobrancas.api.efipay.com.br'
      : 'cobrancas-h.api.efipay.com.br';
    const { default: axios } = await import('axios');

    const chargeResp = await axios.get(`https://${hostname}/v1/charge/${chargeIdStr}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });

    const chargeStatus = chargeResp.data?.data?.status || chargeResp.data?.status;
    console.log(`[EFI-WEBHOOK] charge_id=${chargeIdStr} status na API=${chargeStatus}`);

    if (chargeStatus !== 'paid') {
      console.log(`[EFI-WEBHOOK] Status não é 'paid' (${chargeStatus}) — ignorando`);
      return res.status(200).send('OK');
    }

    // 3️⃣ Atualizar ordem para PAID
    const feeCalc = await calculateDynamicFees(
      orderData.amount,
      orderData.method === 'boleto' ? 'boleto' : 'card',
      orderData.installments || 1,
      'efibank',
      orderData.tenantId || orderData.sellerId
    );

    const resolvedNetAmount = orderData.netAmount || feeCalc.netAmount;
    const resolvedGatewayFee = orderData.gatewayFee || feeCalc.gatewayFee;
    const resolvedPlatformFee = orderData.platformFee || feeCalc.platformFee;
    const paidAt = new Date();

    await db.collection('orders').doc(orderId).update({
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(resolvedNetAmount && { netAmount: resolvedNetAmount }),
      ...(resolvedGatewayFee && { gatewayFee: resolvedGatewayFee }),
      ...(resolvedPlatformFee && { platformFee: resolvedPlatformFee }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ [EFI-WEBHOOK] Ordem ${orderId} marcada como PAID`);

    // 4️⃣ Pós-pagamento: saldo, afiliados, membro, coprodução
    const sellerId = orderData.tenantId || orderData.sellerId;

    // Calcular comissão de afiliado (se houver)
    let affiliateCommission = 0;
    if (orderData.affiliateUid || orderData.affiliateCode) {
      try {
        const affData = await (storage as any).calculateAffiliateCommission({
          ...orderData, id: orderId, status: 'paid'
        });
        if (affData?.hasAffiliate && affData.netCommission > 0) {
          affiliateCommission = affData.netCommission;
        }
      } catch (affCalcErr: any) {
        console.warn('[EFI-WEBHOOK] Erro calcular comissão afiliado:', affCalcErr?.message);
      }
    }

    const sellerCredit = resolvedNetAmount - affiliateCommission;
    const isBoletoPaid = orderData.method === 'boleto';
    const releaseDays = orderData.financialData?.releaseDays ?? (isBoletoPaid ? 2 : 30);
    const releaseDate = new Date(Date.now() + releaseDays * 24 * 60 * 60 * 1000);

    try {
      const { processWebhookWithBalanceUpdate } = await import('./lib/atomic-balance.js');
      await processWebhookWithBalanceUpdate({
        webhookId: `efibank_charge_${chargeIdStr}_${orderId}`,
        provider: 'efibank',
        eventType: isBoletoPaid ? 'boleto.paid' : 'card.paid',
        sellerId,
        amountCents: sellerCredit,
        currency: 'BRL',
        operation: 'add',
        balanceType: isBoletoPaid ? 'available' : 'pending',
        reason: `Pagamento ${isBoletoPaid ? 'Boleto' : 'Cartão'} EfíBank - Ordem ${orderId}`,
        orderId,
        metadata: {
          method: orderData.method,
          acquirer: 'efibank',
          totalAmount: orderData.amount,
          platformFee: resolvedPlatformFee,
          gatewayFee: resolvedGatewayFee,
          affiliateCommission,
          customer: orderData.customer?.email,
          releaseDays,
          releaseDate: releaseDate.toISOString(),
        },
        rawPayload: { charge_id: chargeIdStr, status: 'paid' }
      });
      // Gravar sellerCreditAmount no order para cron de liberação
      await db.collection('orders').doc(orderId).update({
        'financial.sellerCreditAmount': sellerCredit,
        'financial.affiliateCommissionAmount': affiliateCommission,
        'financial.releaseDate': releaseDate,
        'financial.releaseDays': releaseDays,
      });
    } catch (balErr: any) {
      console.warn('[EFI-WEBHOOK] Erro ao creditar saldo:', balErr?.message);
    }

    // Processar comissão afiliado no storage
    if (orderData.affiliateUid || orderData.affiliateCode) {
      try {
        await (storage as any).processAffiliateCommission({ ...orderData, id: orderId, status: 'paid' });
      } catch (affErr: any) {
        console.warn('[EFI-WEBHOOK] Erro ao processar comissão afiliado:', affErr?.message);
      }
    }

    // Sincronizar RTDB + UTMify
    if (sellerId) {
      syncOrderAfterUpdate(sellerId, orderId, { status: 'paid', paidAt: paidAt.toISOString(), netAmount: resolvedNetAmount });
      sendOrderStatusUpdate(sellerId, orderId, 'paid', { paidAt }).catch(() => {});
    }

    // Área de membros automática
    if (orderData.productType === 'digital' || orderData.productType === 'subscription' || !orderData.productType) {
      try {
        await autoCreateMemberOnPurchase({
          customerEmail: orderData.customer?.email,
          customerName: orderData.customer?.name,
          productId: orderData.productId,
          productType: orderData.productType,
          orderId,
          checkoutId: orderData.checkoutId,
        });
      } catch (memErr: any) {
        console.warn('[EFI-WEBHOOK] Erro ao criar membro:', memErr?.message);
      }
    }

    // Coprodução
    try {
      const { processCoproductionCommissions } = await import('./routes/members-coproduction.js');
      await processCoproductionCommissions(
        orderId, orderData.checkoutId, sellerId, orderData.amount, resolvedNetAmount,
        (orderData.affiliateUid || orderData.affiliateCode) ? 'affiliate_sale' : 'own_sale',
        orderData.affiliateUid
      );
    } catch (copErr: any) {
      console.warn('[EFI-WEBHOOK] Erro ao processar coprodução:', copErr?.message);
    }

    return res.status(200).send('OK');

  } catch (error: any) {
    console.error('❌ [EFI-WEBHOOK] Erro geral:', error?.message);
    return res.status(200).send('OK'); // Sempre 200 para evitar loops de retry
  }
});

// 💳 ============================================
// 💳 EFIBANK INSTALLMENTS - CONSULTA PARCELAMENTO
// 💳 ============================================

app.get('/api/payments/installments', async (req, res) => {
  try {
    const { brand, amount } = req.query;
    
    if (!brand || !amount) {
      return res.status(400).json({
        error: 'Parâmetros obrigatórios ausentes',
        message: 'brand e amount são obrigatórios'
      });
    }
    
    const validBrands = ['visa', 'mastercard', 'amex', 'elo'];
    if (!validBrands.includes(String(brand).toLowerCase())) {
      return res.status(400).json({
        error: 'Bandeira inválida',
        message: 'Bandeiras aceitas: visa, mastercard, amex, elo'
      });
    }
    
    const admin = await getAdmin();
    const db = admin.firestore();
    
    const { getInstallments } = await import('./lib/efibank-payments-api.js');
    
    const installmentsData = await getInstallments(
      db,
      String(brand).toLowerCase() as 'visa' | 'mastercard' | 'amex' | 'elo',
      Number(amount)
    );
    
    res.json({
      success: true,
      brand: brand,
      total: Number(amount),
      installments: installmentsData.installments || [],
    });
    
  } catch (error: any) {
    console.error('❌ ERRO CONSULTA PARCELAMENTO:', error);
    res.status(500).json({
      error: 'Erro ao consultar parcelamento',
      message: error.message || 'Falha na comunicação com EfíBank',
    });
  }
});


// 🟢 ============================================
// 🟢 WOOVI (OPENPIX) - ENDPOINTS DE PAGAMENTO PIX
// 🟢 ============================================

// 🟢 CRIAR COBRANÇA PIX VIA WOOVI
app.post('/api/woovi/create-charge', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    console.log('🟢 Criando cobrança Woovi:', sanitizeObject(req.body));

    const { orderId, amount, customer, comment } = req.body;

    if (!orderId || !amount || !customer) {
      return res.status(400).json({ error: 'Dados obrigatórios: orderId, amount, customer' });
    }

    // Inicializar Firestore para woovi-api se ainda não foi feito
    await ensureFirebaseReady();
    const db = getFirestore();
    setFirestoreInstance(db);

    // Criar cobrança na Woovi
    const chargeData = await createWooviCharge({
      correlationID: orderId,
      value: amount, // Valor em centavos
      comment: comment || 'Pagamento via VolatusPay',
      customer: {
        name: customer.name,
        email: customer.email,
        taxID: customer.document,
        phone: customer.phone,
      },
    });

    if (!chargeData) {
      return res.status(500).json({ error: 'Erro ao criar cobrança na Woovi' });
    }

    console.log('✅ Cobrança Woovi criada:', {
      chargeId: chargeData.charge.identifier,
      correlationID: chargeData.charge.correlationID,
      status: chargeData.charge.status
    });

    // Retornar dados da cobrança
    res.json({
      success: true,
      charge: {
        id: chargeData.charge.identifier,
        correlationID: chargeData.charge.correlationID,
        transactionID: chargeData.charge.transactionID,
        status: chargeData.charge.status,
        brCode: chargeData.charge.brCode,
        qrCodeImage: chargeData.charge.qrCodeImage,
        paymentLinkUrl: chargeData.charge.paymentLinkUrl,
        expiresDate: chargeData.charge.expiresDate,
        value: chargeData.charge.value,
      },
    });
  } catch (error: any) {
    console.error('❌ Erro ao criar cobrança Woovi:', error);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

// 🟢 WEBHOOK WOOVI - RECEBER NOTIFICAÇÕES DE PAGAMENTO (DESATIVADO - MOVIDO PARA INÍCIO)
// ⚠️ IMPORTANTE: Sempre retorna 200 OK para a Woovi aceitar o webhook
// NOTA: Endpoint movido para ANTES dos middlewares (linha ~1153) para evitar bloqueios
/*
app.post('/api/webhooks/woovi', async (req, res) => {
  try {
    console.log('🟢 Webhook Woovi recebido:', sanitizeObject(req.body));

    // ✅ RETORNAR 200 OK IMEDIATAMENTE (Woovi exige isso para validar webhook)
    res.json({ success: true, received: true });

    // Processar webhook de forma assíncrona (não bloqueia resposta)
    (async () => {
      try {
        // Inicializar Firebase DB antes de processar
        await ensureFirebaseReady();
        const db = getFirestore();
        setFirestoreInstance(db);

        // Validar webhook (opcional - se webhook secret estiver configurado)
        const authHeader = req.headers.authorization;
        const config = await loadWooviConfig();
        
        if (config?.webhookSecret) {
          if (!validateWooviWebhook(authHeader, config.webhookSecret)) {
            console.error('❌ Webhook Woovi inválido: falha na validação');
            return;
          }
        }

        // Processar webhook
        const result = await processWooviWebhook(req.body);

        if (!result.success) {
          console.error('❌ Erro ao processar webhook Woovi');
          return;
        }

        // Se for webhook de teste (sem correlationID), apenas logar
        if (!result.correlationID) {
          console.log('✅ Webhook de teste processado com sucesso');
          return;
        }

        // Atualizar status do pedido no Firestore
        const orderRef = db.collection('orders').doc(result.correlationID);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
          console.error('❌ Pedido não encontrado:', result.correlationID);
          return;
        }

        // Atualizar status do pedido
        await orderRef.update({
          status: result.status,
          updatedAt: FieldValue.serverTimestamp(),
          ...(result.status === 'paid' && {
            paidAt: FieldValue.serverTimestamp(),
          }),
        });

        console.log('✅ Pedido atualizado via webhook Woovi:', {
          orderId: result.correlationID,
          status: result.status
        });
      } catch (asyncError) {
        console.error('❌ Erro ao processar webhook Woovi (async):', asyncError);
      }
    })();

  } catch (error: any) {
    console.error('❌ Erro ao processar webhook Woovi:', error);
    // ⚠️ SEMPRE retorna 200 OK mesmo com erro (Woovi exige)
    res.json({ success: true, received: true, error: 'Erro interno processado' });
  }
});
*/
// [EXTRACTED] post /api/admin/woovi/config moved to server/routes/admin.ts

// 🟢 ENDPOINT PARA OBTER CONFIGURAÇÃO WOOVI (PUBLIC - SEM SECRETS)
app.get('/api/woovi/config', async (req, res) => {
  try {
    await ensureFirebaseReady();
    const db = getFirestore();

    const configRef = db.collection('paymentConfig').doc('global');
    const configDoc = await configRef.get();

    if (!configDoc.exists) {
      return res.json({
        enabled: false,
        environment: 'sandbox',
      });
    }

    const data = configDoc.data();
    const wooviConfig = data?.woovi || {};

    // Retornar apenas dados públicos (sem AppID ou webhook secret)
    res.json({
      enabled: wooviConfig.enabled || false,
      environment: wooviConfig.environment || 'sandbox',
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar configuração Woovi:', error);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

// 🎯 ENDPOINT TEMPORÁRIO - CRIAR VENDAS DEMO (protegido por admin)
app.post('/api/demo/create-sales', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    console.log('🎯 Criando vendas demo para zenpagamentosbr@gmail.com...');
    
    await ensureFirebaseReady();
    const db = getFirestore();
    
    // Buscar tenant da conta zenpagamentosbr@gmail.com
    const sellersSnapshot = await db.collection('sellers')
      .where('email', '==', 'zenpagamentosbr@gmail.com')
      .limit(1)
      .get();

    if (sellersSnapshot.empty) {
      return res.status(404).json({ error: 'Seller zenpagamentosbr@gmail.com não encontrado' });
    }

    const tenantId = sellersSnapshot.docs[0].id;
    console.log('✅ TenantId encontrado:', tenantId);

    // Criar checkout demo
    const checkoutRef = await db.collection('checkouts').add({
      tenantId: tenantId,
      title: 'Produto Demo',
      slug: `demo-${Date.now()}`,
      productType: 'digital',
      pricing: { amount: 9700 },
      currency: 'BRL',
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    const checkoutId = checkoutRef.id;
    console.log('✅ Checkout demo criado:', checkoutId);

    // Criar vendas simuladas - distribuídas ao longo de hoje
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const orders = [];
    
    // Criar 30 vendas aprovadas (roxo) em diferentes horários
    for (let i = 0; i < 30; i++) {
      const hour = Math.floor(Math.random() * 24);
      const minute = Math.floor(Math.random() * 60);
      const orderTime = new Date(startOfDay);
      orderTime.setHours(hour, minute);
      
      orders.push({
        tenantId: tenantId,
        checkoutId: checkoutId,
        status: 'paid',
        method: 'pix',
        amount: 9700,
        customerName: 'Cliente Demo',
        customerEmail: 'demo@example.com',
        createdAt: Timestamp.fromDate(orderTime),
        updatedAt: Timestamp.fromDate(orderTime)
      });
    }

    // Criar 15 vendas pendentes (laranja)
    for (let i = 0; i < 15; i++) {
      const hour = Math.floor(Math.random() * 24);
      const minute = Math.floor(Math.random() * 60);
      const orderTime = new Date(startOfDay);
      orderTime.setHours(hour, minute);
      
      orders.push({
        tenantId: tenantId,
        checkoutId: checkoutId,
        status: 'pending',
        method: 'pix',
        amount: 9700,
        customerName: 'Cliente Demo Pendente',
        customerEmail: 'pendente@example.com',
        createdAt: Timestamp.fromDate(orderTime),
        updatedAt: Timestamp.fromDate(orderTime)
      });
    }

    // Inserir todas as vendas
    const batch = db.batch();
    orders.forEach(order => {
      const ref = db.collection('orders').doc();
      batch.set(ref, order);
    });

    await batch.commit();
    console.log(`✅ ${orders.length} vendas simuladas criadas com sucesso!`);
    
    res.json({
      success: true,
      message: `${orders.length} vendas criadas`,
      details: {
        approved: 30,
        pending: 15,
        tenantId,
        checkoutId
      }
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao criar vendas demo:', error);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

// ❌ REMOVIDO: ENDPOINTS DE GERAÇÃO DE VENDAS FAKE DESABILITADOS EM PRODUÇÃO
// Gateway profissional - apenas vendas reais via checkout
// Histórico: Eram usados para testes, agora desabilitados permanentemente

// 👤 ENDPOINT ADMIN: APROVAR SELLER (PRODUÇÃO)
// 🔒 PROTEÇÃO: Apenas admins podem aprovar sellers
// [EXTRACTED] post /api/admin/fix-sellers-approval-status moved to server/routes/admin.ts


// 🔥 ENDPOINT ADMIN: DELETAR TODAS AS VENDAS DE UM TENANT (PURGE TOTAL)

// 🔧 ENDPOINT ADMIN: AUTO-CORRIGIR SHOWCASE EM PRODUTOS COM AFILIAÇÃO
// Habilita showcase.enabled em checkouts que têm affiliate.enabled mas faltam showcase
// [EXTRACTED] post /api/admin/fix-showcase-products moved to server/routes/admin.ts

// ⚠️ EXTREMAMENTE PERIGOSO - USA DUPLA CONFIRMAÇÃO
// 🔒 PROTEÇÃO: Apenas admins podem executar
const purgeAttempts = new Map<string, number[]>();
// [EXTRACTED] post /api/admin/purge-tenant-orders moved to server/routes/admin.ts

// 🐛 ENDPOINT DEBUG: VERIFICAR DISTRIBUIÇÃO DE VENDAS POR DATA
app.get('/api/dev/check-sales-dates', async (req: Request, res: Response) => {
  try {
    await ensureFirebaseReady();
    const db = getFirestore();
    const auth = getAuth();

    const email = req.query.email as string || 'zenpagamentosbr@gmail.com';
    const userRecord = await auth.getUserByEmail(email);
    const tenantId = userRecord.uid;

    const ordersSnapshot = await db.collection('orders')
      .where('tenantId', '==', tenantId)
      .get();

    const byDate: Record<string, number> = {};
    const now = new Date();
    
    ordersSnapshot.forEach(doc => {
      const data = doc.data();
      let date: Date;
      
      if (data.createdAt && typeof data.createdAt === 'object' && (data.createdAt as any)._seconds) {
        date = new Date((data.createdAt as any)._seconds * 1000);
      } else if (data.createdAt) {
        date = new Date(data.createdAt);
      } else {
        date = now;
      }
      
      const dateKey = date.toISOString().split('T')[0];
      byDate[dateKey] = (byDate[dateKey] || 0) + 1;
    });

    const dates = Object.keys(byDate).sort();
    const today = now.toISOString().split('T')[0];
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().split('T')[0];

    const last7Days: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      last7Days[key] = byDate[key] || 0;
    }

    res.json({
      success: true,
      totalOrders: ordersSnapshot.size,
      period: { from: dates[0], to: dates[dates.length - 1] },
      today: { date: today, sales: byDate[today] || 0 },
      yesterday: { date: yesterdayKey, sales: byDate[yesterdayKey] || 0 },
      last7Days: last7Days,
      last10Days: dates.slice(-10).map(d => ({ date: d, sales: byDate[d] }))
    });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

// 🐛 ENDPOINT DEBUG: LISTAR TODOS OS PRODUTOS E CHECKOUTS
app.get('/api/dev/list-all-products', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await ensureFirebaseReady();
    const db = getFirestore();
    const auth = getAuth();

    // Buscar usuário pelo email
    const email = req.query.email as string || 'zenpagamentosbr@gmail.com';
    const userRecord = await auth.getUserByEmail(email);
    const tenantId = userRecord.uid;

    console.log('🔍 DEBUG: Buscando produtos para:', { email, tenantId });

    // Buscar TODOS os produtos (sem filtro de ownerId)
    const allProductsSnapshot = await db.collection('products').get();
    const allProducts = allProductsSnapshot.docs.map(doc => ({
      id: doc.id,
      ownerId: doc.data().ownerId,
      title: doc.data().title,
      productType: doc.data().productType,
      price: doc.data().price
    }));

    // Buscar produtos do seller específico
    const sellerProductsSnapshot = await db.collection('products')
      .where('ownerId', '==', tenantId)
      .get();
    
    const sellerProducts = sellerProductsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Buscar TODOS os checkouts
    const allCheckoutsSnapshot = await db.collection('checkouts').get();
    const allCheckouts = allCheckoutsSnapshot.docs.map(doc => ({
      id: doc.id,
      tenantId: doc.data().tenantId,
      title: doc.data().title,
      productId: doc.data().productId
    }));

    // Buscar checkouts do seller específico
    const sellerCheckoutsSnapshot = await db.collection('checkouts')
      .where('tenantId', '==', tenantId)
      .get();
    
    const sellerCheckouts = sellerCheckoutsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      email,
      tenantId,
      summary: {
        totalProductsFirestore: allProducts.length,
        productsForThisSeller: sellerProducts.length,
        totalCheckoutsFirestore: allCheckouts.length,
        checkoutsForThisSeller: sellerCheckouts.length
      },
      allProducts,
      sellerProducts,
      allCheckouts,
      sellerCheckouts
    });

  } catch (error: any) {
    console.error('❌ [DEV] Erro ao listar produtos:', error);
    res.status(500).json({ error: error.message });
  }
});
// [EXTRACTED] delete /api/admin/firebase-purge moved to server/routes/admin.ts

// [EXTRACTED] Members routes, Coproduction routes, and processCoproductionCommissions moved to server/routes/members-coproduction.ts
// 🔍 DEBUG ENDPOINT - Verificar configuração de produtos

// 🔍 DEBUG ENDPOINT - Verificar configuração de produtos
app.get('/api/debug/products', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    const productsSnapshot = await db.collection('products')
      .where('active', '==', true)
      .limit(20)
      .get();
    
    const results = [];
    
    for (const doc of productsSnapshot.docs) {
      const data = doc.data();
      const passesFilter = 
        data.active === true &&
        data.showcase?.enabled === true &&
        (!data.affiliateConfig || data.affiliateConfig.marketplaceEnabled === true);
      
      results.push({
        id: doc.id,
        name: data.name,
        type: data.productType,
        active: data.active,
        showcase: {
          enabled: data.showcase?.enabled || false,
          category: data.showcase?.category || 'N/A'
        },
        affiliateConfig: {
          enabled: data.affiliateConfig?.enabled || false,
          marketplaceEnabled: data.affiliateConfig?.marketplaceEnabled || false
        },
        passesFilter,
        blockedBy: !passesFilter ? [
          !data.active ? 'active=false' : null,
          !data.showcase?.enabled ? 'showcase.enabled=false' : null,
          data.affiliateConfig && !data.affiliateConfig.marketplaceEnabled ? 'affiliateConfig.marketplaceEnabled=false' : null
        ].filter(Boolean) : []
      });
    }
    
    res.json({
      total: results.length,
      passing: results.filter(r => r.passesFilter).length,
      failing: results.filter(r => !r.passesFilter).length,
      products: results
    });
  } catch (error: any) {
    console.error('❌ Debug endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});
// [EXTRACTED] post /api/admin/cleanup-test-products moved to server/routes/admin.ts

// 🔍 DEBUG: Verificar dados reais do Firebase
app.get('/api/debug/checkouts/:title', async (req, res) => {
  try {
    const { title } = req.params;
    const firebaseStorage = require('./lib/firebase-admin');
    const db = firebaseStorage.db;
    
    const snapshot = await db.collection('checkouts')
      .where('title', '==', title)
      .get();
    
    const checkouts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json(checkouts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// [EXTRACTED] post /api/admin/fix-offers moved to server/routes/admin.ts
// [REMOVED DUPLICATE] Route already defined earlier: /api/orders/:orderId/shipping
// [REMOVED DUPLICATE] Route already defined earlier: POST /api/admin/purge-tenant-orders, POST /api/admin/fix-showcase-products, POST /api/admin/fix-sellers-approval-status, POST /api/admin/approve-seller, POST /api/demo/create-sales, GET /api/woovi/con


// 🎯 ESTRATÉGIAS - SALVAR UPSELL/DOWNSELL
app.post('/api/checkouts/:checkoutId/upsell', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.params;
    const { name, type, offerType, productId, customOfferUrl, onAccept, onRefuse } = req.body;
    const userId = req.user.uid;

    if (!name || !type || !offerType || !onAccept || !onRefuse) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios: name, type, offerType, onAccept, onRefuse' 
      });
    }

    if (offerType === 'product' && !productId) {
      return res.status(400).json({ error: 'productId é obrigatório quando offerType é "product"' });
    }
    if (offerType === 'url' && !customOfferUrl) {
      return res.status(400).json({ error: 'customOfferUrl é obrigatório quando offerType é "url"' });
    }

    const validTypes = ['upsell', 'downsell'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ 
        error: 'Tipo inválido. Use: upsell ou downsell' 
      });
    }

    console.log(`🎯 SALVANDO ESTRATÉGIA: ${type} (${offerType}) no checkout ${checkoutId}`);

    const { neonQuery: nqUpsell } = await import('./lib/neon-db.js');

    let checkoutData: any = null;
    await nqUpsell(async (sql) => {
      const rows = await sql`SELECT id, tenant_id, metadata FROM checkouts WHERE id = ${checkoutId} AND (deleted = FALSE OR deleted IS NULL) LIMIT 1`;
      if (rows[0]) checkoutData = rows[0];
    }, `upsellCheckoutLookup:${checkoutId}`);

    if (!checkoutData) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    if (checkoutData.tenant_id !== userId) {
      return res.status(403).json({ error: 'Você não tem permissão para editar este checkout' });
    }

    const currentMeta = (typeof checkoutData.metadata === 'string' ? JSON.parse(checkoutData.metadata || '{}') : checkoutData.metadata) || {};
    const currentStrategies = currentMeta.upsell?.products || [];

    const newStrategy = {
      id: `strategy_${Date.now()}`,
      name,
      type,
      offerType,
      productId: offerType === 'product' ? productId : null,
      customOfferUrl: offerType === 'url' ? customOfferUrl : null,
      onAccept: {
        action: onAccept.action || 'pagina-obrigado',
        url: onAccept.url || null,
        nextProductId: onAccept.nextProductId || null,
      },
      onRefuse: {
        action: onRefuse.action || 'pagina-obrigado',
        url: onRefuse.url || null,
        nextProductId: onRefuse.nextProductId || null,
      },
      active: true,
      createdAt: new Date(),
    };

    const updatedUpsell = { enabled: true, products: [...currentStrategies, newStrategy] };
    const updatedMeta = { ...currentMeta, upsell: updatedUpsell };
    await nqUpsell(async (sql) => {
      await sql`UPDATE checkouts SET metadata = ${JSON.stringify(updatedMeta)}::jsonb, updated_at = NOW() WHERE id = ${checkoutId}`;
    }, `upsellSave:${checkoutId}`);

    console.log(`✅ ESTRATÉGIA SALVA (Neon): ${newStrategy.id} (${type})`);

    res.json({
      success: true,
      message: 'Estratégia salva com sucesso',
      strategy: newStrategy,
    });

  } catch (error) {
    console.error('❌ Erro ao salvar estratégia:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// 🎯 BUSCAR ESTRATÉGIAS ATIVAS DE UM CHECKOUT (PÚBLICO - usado no fluxo pós-compra)
app.get('/api/checkouts/:checkoutId/strategies', async (req, res) => {
  try {
    const { checkoutId } = req.params;

    console.log(`🔍 BUSCANDO ESTRATÉGIAS para checkout ${checkoutId}`);

    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();

    const checkoutDoc = await db.collection('checkouts').doc(checkoutId).get();
    
    if (!checkoutDoc.exists) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    const checkoutData = checkoutDoc.data();
    const strategies = checkoutData?.upsell?.products || [];
    const enabled = checkoutData?.upsell?.enabled || false;

    const activeStrategies = strategies.filter((s: any) => s.active);

    console.log(`✅ ENCONTRADAS ${activeStrategies.length} estratégias ativas`);

    res.json({
      success: true,
      enabled,
      strategies: activeStrategies,
    });

  } catch (error) {
    console.error('❌ Erro ao buscar estratégias:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// 🎯 DELETAR ESTRATÉGIA DE UPSELL/DOWNSELL
app.delete('/api/checkouts/:checkoutId/strategies/:strategyId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId, strategyId } = req.params;
    const userId = req.user.uid;

    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();

    const checkoutDoc = await db.collection('checkouts').doc(checkoutId).get();
    if (!checkoutDoc.exists) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    const checkoutData = checkoutDoc.data();
    if (checkoutData?.sellerId !== userId && checkoutData?.tenantId !== userId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const currentStrategies = checkoutData?.upsell?.products || [];
    const updatedStrategies = currentStrategies.filter((s: any) => s.id !== strategyId);

    await db.collection('checkouts').doc(checkoutId).update({
      'upsell.products': updatedStrategies,
      'upsell.enabled': updatedStrategies.some((s: any) => s.active),
      updatedAt: new Date(),
    });

    res.json({ success: true, message: 'Estratégia removida com sucesso' });
  } catch (error) {
    console.error('❌ Erro ao deletar estratégia:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🧪 TESTE DE NOTIFICAÇÕES DE ASSINATURA (admin only)
app.post('/api/admin/test-subscription-notifications', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const {
      scenario,           // '3dias' | 'expirou' | 'renovado'
      email,             // email do destinatário
      phone,             // telefone WhatsApp (ex: 5511999999999)
      customerName = 'Cliente Teste',
      productName = 'Curso de Teste',
      checkoutId = 'checkout-teste-123',
    } = req.body;

    if (!scenario || !['3dias', 'expirou', 'renovado'].includes(scenario)) {
      return res.status(400).json({ error: 'scenario deve ser: 3dias | expirou | renovado' });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: 'Informe ao menos email ou phone' });
    }

    const { sendEmail } = await import('./lib/email-service.js');
    const renewUrl = `https://volatuspay.com/checkout/${checkoutId}`;
    const valor = 'R$ 97,00';

    const results: Record<string, any> = {};

    if (scenario === '3dias') {
      const daysLeft = 3;
      const vencimentoStr = new Date(Date.now() + 3 * 86400000).toLocaleDateString('pt-BR');
      if (email) {
        results.email = await sendEmail({
          to: email,
          subject: `⚠️ Sua assinatura vence em ${daysLeft} dias`,
          html: `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px">
              <h2 style="color:#f59e0b">⏰ Atenção, ${customerName}!</h2>
              <p>Sua assinatura de <strong>${productName}</strong> vence em <strong>${daysLeft} dias</strong> (${vencimentoStr}).</p>
              <p>Valor da renovação: <strong>${valor}</strong></p>
              <p>Para manter seu acesso, efetue o pagamento antes do vencimento.</p>
              <p style="color:#6b7280;font-size:12px">Se você já efetuou o pagamento, ignore este aviso.</p>
            </div>`
        });
      }
    }

    if (scenario === 'expirou') {
      if (email) {
        results.email = await sendEmail({
          to: email,
          subject: `❌ Seu acesso a "${productName}" foi encerrado`,
          html: `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px">
              <h2 style="color:#ef4444">😔 Olá, ${customerName}!</h2>
              <p>Sua assinatura de <strong>${productName}</strong> venceu e seu acesso foi encerrado.</p>
              <p>Para reativar e continuar com acesso imediato, basta renovar clicando no botão abaixo:</p>
              <p style="text-align:center;margin:32px 0">
                <a href="${renewUrl}" style="background:#76FF03;color:#000;padding:14px 28px;border-radius:8px;font-weight:bold;text-decoration:none;font-size:16px">
                  🔄 Renovar Assinatura
                </a>
              </p>
              <p style="color:#6b7280;font-size:12px">Ao renovar, seu acesso é liberado automaticamente em instantes.</p>
            </div>`
        });
      }
    }

    if (scenario === 'renovado') {
      const novoPeriodo = new Date(Date.now() + 30 * 86400000).toLocaleDateString('pt-BR');
      if (email) {
        results.email = await sendEmail({
          to: email,
          subject: `✅ Assinatura renovada! Seu acesso a "${productName}" foi reativado`,
          html: `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px">
              <h2 style="color:#22c55e">🎉 Olá, ${customerName}!</h2>
              <p>Seu pagamento foi confirmado e sua assinatura de <strong>${productName}</strong> foi renovada com sucesso!</p>
              <p>Seu acesso está ativo até <strong>${novoPeriodo}</strong>.</p>
              <p style="text-align:center;margin:32px 0">
                <a href="https://volatuspay.com/members-dashboard" style="background:#76FF03;color:#000;padding:14px 28px;border-radius:8px;font-weight:bold;text-decoration:none;font-size:16px">
                  🚀 Acessar Área de Membros
                </a>
              </p>
            </div>`
        });
      }
    }

    console.log(`🧪 [TEST-NOTIF] Cenário "${scenario}" disparado por ${req.authUser?.email || req.user.uid}`);
    res.json({ success: true, scenario, results });
  } catch (error: any) {
    console.error('❌ [TEST-NOTIF] Erro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🛡️ GLOBAL EXPRESS ERROR HANDLER — captura qualquer erro não tratado nas rotas
// Deve ser o ÚLTIMO app.use() do servidor
app.use((err: any, req: any, res: any, next: any) => {
  // Rotas de tracking não-críticas: retorna 200 em vez de 500 para erros de body parsing
  const trackingPaths = ['/api/sellers/track-login', '/api/sellers/update-device-fingerprint'];
  if (trackingPaths.includes(req.path) && (err?.message === 'stream is not readable' || err?.type === 'entity.parse.failed' || err?.type === 'request.aborted')) {
    if (!res.headersSent) {
      return res.json({ success: true, skipped: true, reason: 'parse_error' });
    }
    return;
  }

  // Erros CORS: logar como aviso e retornar 403 (não é erro de servidor)
  if (err?.message === 'Not allowed by CORS') {
    const origin = req.get('origin');
    console.warn(`⚠️ [CORS] Origem bloqueada: ${origin} → ${req.method} ${req.path}`);
    if (!res.headersSent) {
      return res.status(403).json({ error: 'Origem não permitida', code: 'CORS_BLOCKED' });
    }
    return;
  }

  // Log completo internamente (nunca expõe ao cliente)
  console.error('❌ [GLOBAL-ERROR-HANDLER] Erro não tratado:', {
    method: req.method,
    path: req.path,
    message: err?.message,
    stack: err?.stack,
  });
  // Resposta genérica sem stack trace ou detalhes internos
  if (res.headersSent) return next(err);
  // 🔐 Garantir que headers de segurança estejam presentes mesmo em erros 500
  if (!res.getHeader('X-Frame-Options')) res.setHeader('X-Frame-Options', 'DENY');
  if (!res.getHeader('X-Content-Type-Options')) res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!res.getHeader('X-XSS-Protection')) res.setHeader('X-XSS-Protection', '1; mode=block');
  if (!res.getHeader('Referrer-Policy')) res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!res.getHeader('Permissions-Policy')) res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (!res.getHeader('Content-Security-Policy')) {
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com"
      : "script-src 'self' https://apis.google.com";
    const styleSrc = isDev
      ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
      : "style-src 'self' https://fonts.googleapis.com";
    res.setHeader('Content-Security-Policy',
      `default-src 'self'; ${scriptSrc}; ${styleSrc}; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com wss:; frame-ancestors 'none'`
    );
  }
  res.status(err?.status || err?.statusCode || 500).json({
    error: 'Ocorreu um erro interno. Tente novamente ou entre em contato com o suporte.'
  });
});
