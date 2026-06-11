/**
 * 🚫 ENTITY BLOCKER - SISTEMA AVANÇADO DE BLOQUEIO
 * 
 * Bloqueia por múltiplos identificadores:
 * - UID da conta Firebase
 * - IP da rede
 * - Device Fingerprint (máquina/navegador)
 * 
 * Histórico completo de bloqueios com motivo, timestamp e dados da conta
 */

import { getFirestore } from '../lib/firebase-admin';
import { Request, Response, NextFunction } from 'express';

export interface BlockedEntity {
  id: string; // ID único do bloqueio
  type: 'uid' | 'ip' | 'deviceFingerprint' | 'multi'; // Tipo de bloqueio
  
  // Identificadores bloqueados
  uid?: string; // UID da conta Firebase
  ip?: string; // IP da rede
  deviceFingerprint?: string; // Fingerprint do dispositivo
  
  // Informações do bloqueio
  reason: string; // Motivo do bloqueio
  severity: 'critical' | 'high' | 'medium'; // Gravidade
  timestamp: string; // Data/hora do bloqueio
  blockedBy: string; // UID do admin que bloqueou
  
  // Dados da conta no momento do bloqueio
  accountData?: {
    email?: string;
    displayName?: string;
    phoneNumber?: string;
    tenantId?: string;
    lastLogin?: string;
    accountCreated?: string;
  };
  
  // Dados técnicos do dispositivo
  deviceData?: {
    userAgent?: string;
    os?: string;
    browser?: string;
    platform?: string;
    screenResolution?: string;
    timezone?: string;
    language?: string;
    isp?: string;
    country?: string;
    city?: string;
  };
  
  // Metadados
  expiresAt?: string; // Data de expiração (null = permanente)
  notes?: string; // Notas adicionais do admin
  active: boolean; // Bloqueio ativo?
  unlockedAt?: string; // Data de desbloqueio
  unlockedBy?: string; // UID do admin que desbloqueou
  unlockReason?: string; // Motivo do desbloqueio
}

export class EntityBlocker {
  private static instance: EntityBlocker;
  private db: FirebaseFirestore.Firestore | null = null;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  
  // 📊 TELEMETRIA - Monitoramento em tempo real
  private telemetry = {
    totalChecks: 0,
    blockedAttempts: 0,
    allowedAttempts: 0,
    errors: 0,
    lastCheck: null as Date | null,
    lastBlock: null as { uid?: string; ip?: string; reason: string; timestamp: Date } | null
  };
  
  private constructor() {
    // Não inicializar no construtor - aguardar initialize()
  }
  
  public static getInstance(): EntityBlocker {
    if (!EntityBlocker.instance) {
      EntityBlocker.instance = new EntityBlocker();
    }
    return EntityBlocker.instance;
  }
  
  /**
   * 🔧 INICIALIZAR COM RETRY - Aguarda Firebase estar pronto
   */
  public async initialize(maxRetries = 5, retryDelay = 1000): Promise<void> {
    // ✅ CRITICAL: Verificar inicialização ANTES do promise gate
    // Isso permite que chamadas concorrentes após sucesso retornem imediatamente
    if (this.isInitialized && this.db) {
      return Promise.resolve();
    }
    
    // Se já inicializando, aguardar
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    this.initializationPromise = (async () => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          this.db = getFirestore();
          if (this.db) {
            this.isInitialized = true;
            // ✅ LIMPAR PROMISE após sucesso para permitir short-circuit
            this.initializationPromise = null;
            console.log('✅ EntityBlocker inicializado com sucesso!');
            return;
          }
        } catch (error) {
          console.warn(`⚠️ EntityBlocker: Tentativa ${attempt}/${maxRetries} falhou`);
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }
      
      // ❌ CRITICAL FIX: Resetar promise antes de lançar erro
      // Isso permite que futuras tentativas de initialize() possam tentar novamente
      this.initializationPromise = null;
      throw new Error('❌ EntityBlocker: Firebase não disponível após múltiplas tentativas');
    })();
    
    // ⚠️ CATCH HANDLER: Se falhar, resetar promise para permitir retry futuro
    return this.initializationPromise.catch((error) => {
      this.initializationPromise = null;
      throw error;
    });
  }
  
  /**
   * 📊 OBTER TELEMETRIA
   */
  public getTelemetry() {
    return {
      ...this.telemetry,
      uptime: this.isInitialized ? 'ONLINE' : 'OFFLINE',
      blockRate: this.telemetry.totalChecks > 0 
        ? ((this.telemetry.blockedAttempts / this.telemetry.totalChecks) * 100).toFixed(2) + '%'
        : '0%'
    };
  }
  
  /**
   * ✅ READINESS CHECK
   */
  public isReady(): boolean {
    return this.isInitialized && this.db !== null;
  }
  
  /**
   * 🚫 BLOQUEAR ENTIDADE
   */
  async blockEntity(data: {
    uid?: string;
    ip?: string;
    deviceFingerprint?: string;
    reason: string;
    severity: 'critical' | 'high' | 'medium';
    blockedBy: string;
    accountData?: BlockedEntity['accountData'];
    deviceData?: BlockedEntity['deviceData'];
    notes?: string;
    expiresAt?: string;
  }): Promise<BlockedEntity> {
    if (!this.db) throw new Error('Firebase não disponível');
    
    // Determinar tipo de bloqueio
    const identifiers = [data.uid, data.ip, data.deviceFingerprint].filter(Boolean);
    const type = identifiers.length > 1 ? 'multi' : 
                 data.uid ? 'uid' :
                 data.ip ? 'ip' : 'deviceFingerprint';
    
    const blockedEntity: BlockedEntity = {
      id: `block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      uid: data.uid,
      ip: data.ip,
      deviceFingerprint: data.deviceFingerprint,
      reason: data.reason,
      severity: data.severity,
      timestamp: new Date().toISOString(),
      blockedBy: data.blockedBy,
      accountData: data.accountData,
      deviceData: data.deviceData,
      notes: data.notes,
      expiresAt: data.expiresAt,
      active: true
    };
    
    // Salvar no Firestore
    await this.db.collection('blockedEntities').doc(blockedEntity.id).set(blockedEntity);
    
    console.log('🚫 ENTIDADE BLOQUEADA:', {
      id: blockedEntity.id,
      type: blockedEntity.type,
      uid: blockedEntity.uid,
      ip: blockedEntity.ip,
      fingerprint: blockedEntity.deviceFingerprint,
      reason: blockedEntity.reason,
      blockedBy: blockedEntity.blockedBy
    });
    
    return blockedEntity;
  }
  
  /**
   * ✅ DESBLOQUEAR ENTIDADE
   */
  async unblockEntity(blockId: string, unlockedBy: string, unlockReason: string): Promise<void> {
    if (!this.db) throw new Error('Firebase não disponível');
    
    const docRef = this.db.collection('blockedEntities').doc(blockId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      throw new Error('Bloqueio não encontrado');
    }
    
    await docRef.update({
      active: false,
      unlockedAt: new Date().toISOString(),
      unlockedBy,
      unlockReason
    });
    
    console.log('✅ ENTIDADE DESBLOQUEADA:', {
      id: blockId,
      unlockedBy,
      unlockReason
    });
  }
  
  /**
   * 🔍 VERIFICAR SE ENTIDADE ESTÁ BLOQUEADA
   */
  async isBlocked(data: {
    uid?: string;
    ip?: string;
    deviceFingerprint?: string;
  }): Promise<{
    blocked: boolean;
    block?: BlockedEntity;
  }> {
    // 📊 TELEMETRIA: Registrar verificação
    this.telemetry.totalChecks++;
    this.telemetry.lastCheck = new Date();
    
    // 🚨 FAIL-OPEN: Retornar não bloqueado se Firestore não disponível (graceful degradation)
    if (!this.db) {
      this.telemetry.errors++;
      console.warn('⚠️ Entity Blocker: Firestore não inicializado - retornando não bloqueado (fail-open)');
      return { blocked: false };
    }
    
    try {
      const collection = this.db.collection('blockedEntities');
      
      // Verificar bloqueios ativos
      const queries = [];
      
      if (data.uid) {
        queries.push(
          collection.where('active', '==', true)
                   .where('uid', '==', data.uid)
                   .limit(1)
                   .get()
        );
      }
      
      if (data.ip) {
        queries.push(
          collection.where('active', '==', true)
                   .where('ip', '==', data.ip)
                   .limit(1)
                   .get()
        );
      }
      
      if (data.deviceFingerprint) {
        queries.push(
          collection.where('active', '==', true)
                   .where('deviceFingerprint', '==', data.deviceFingerprint)
                   .limit(1)
                   .get()
        );
      }
      
      // Executar todas as queries em paralelo
      const results = await Promise.all(queries);
      
      // Verificar se alguma query encontrou bloqueio
      for (const snapshot of results) {
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const block = doc.data() as BlockedEntity;
          
          // Verificar se o bloqueio ainda é válido (não expirou)
          if (block.expiresAt) {
            const expiresAt = new Date(block.expiresAt);
            if (expiresAt < new Date()) {
              // Bloqueio expirado - desativar automaticamente
              await doc.ref.update({ active: false });
              continue;
            }
          }
          
          // 📊 TELEMETRIA: Registrar bloqueio
          this.telemetry.blockedAttempts++;
          this.telemetry.lastBlock = {
            uid: data.uid,
            ip: data.ip,
            reason: block.reason,
            timestamp: new Date()
          };
          
          return { blocked: true, block };
        }
      }
      
      // 📊 TELEMETRIA: Registrar acesso permitido
      this.telemetry.allowedAttempts++;
      
      return { blocked: false };
    } catch (error) {
      console.error('❌ Erro ao verificar bloqueio:', error);
      // 📊 TELEMETRIA: Registrar erro
      this.telemetry.errors++;
      
      // 🚨 FAIL-CLOSED: Propagar erro ao invés de retornar false
      // Isso faz com que o middleware capture o erro e retorne 503
      throw new Error(`Falha ao verificar bloqueio: ${error.message || 'Firestore indisponível'}`);
    }
  }
  
  /**
   * 📋 LISTAR TODOS OS BLOQUEIOS
   */
  async listBlocks(filters?: {
    active?: boolean;
    type?: BlockedEntity['type'];
    severity?: BlockedEntity['severity'];
    limit?: number;
  }): Promise<BlockedEntity[]> {
    if (!this.db) return [];
    
    try {
      let query = this.db.collection('blockedEntities') as FirebaseFirestore.Query;
      
      if (filters?.active !== undefined) {
        query = query.where('active', '==', filters.active);
      }
      
      if (filters?.type) {
        query = query.where('type', '==', filters.type);
      }
      
      if (filters?.severity) {
        query = query.where('severity', '==', filters.severity);
      }
      
      if (filters?.limit) {
        query = query.limit(filters.limit);
      }
      
      const snapshot = await query.get();
      const blocks = snapshot.docs.map(doc => doc.data() as BlockedEntity);
      
      // Ordenar no backend (depois de buscar)
      blocks.sort((a, b) => {
        const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return dateB - dateA; // desc
      });
      
      return blocks;
    } catch (error) {
      console.error('❌ Erro ao listar bloqueios:', error);
      return [];
    }
  }
  
  /**
   * 🔒 MIDDLEWARE DE BLOQUEIO
   * Verifica se a entidade está bloqueada antes de permitir acesso
   */
  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // ⚡ STARTUP GRACE PERIOD: Se ainda não está inicializado, deixa passar
        // Isso evita bloquear requisições durante os primeiros segundos do servidor
        if (!this.isReady()) {
          return next();
        }
        
        // Extrair identificadores do request
        const uid = (req as any).user?.uid;
        const ip = (req as any).realIP || req.ip;
        const deviceFingerprint = (req as any).deviceFingerprint;
        
        // Verificar se está bloqueado
        const result = await this.isBlocked({ uid, ip, deviceFingerprint });
        
        if (result.blocked && result.block) {
          console.error('🚫 ACESSO BLOQUEADO:', {
            uid,
            ip,
            deviceFingerprint,
            reason: result.block.reason,
            severity: result.block.severity,
            blockedAt: result.block.timestamp
          });
          
          return res.status(403).json({
            success: false,
            error: 'Acesso bloqueado',
            message: 'Sua conta ou dispositivo foi bloqueado por violar os termos de uso.',
            reason: result.block.reason,
            blockedAt: result.block.timestamp,
            contactSupport: 'Entre em contato com o suporte para mais informações.'
          });
        }
        
        next();
      } catch (error) {
        console.error('❌ EntityBlocker middleware error:', error);
        
        // ⚡ FAIL-OPEN durante inicialização: Deixa passar se ainda não está pronto
        // FAIL-CLOSED após inicialização: Bloqueia se houver erro real
        if (!this.isReady()) {
          return next();
        }
        
        return res.status(503).json({
          success: false,
          error: 'Sistema de segurança temporariamente indisponível',
          message: 'Não foi possível verificar o status de segurança. Tente novamente em instantes.',
          code: 'SECURITY_CHECK_FAILED'
        });
      }
    };
  }
}

export const entityBlocker = EntityBlocker.getInstance();
