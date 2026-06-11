/**
 * 🔍 SHADOW MODE - SISTEMA DE APROVAÇÃO HUMANA PARA BLOQUEIOS IA
 * 
 * Reduz falsos positivos exigindo aprovação humana antes de bloqueios automáticos
 * IA detecta ameaças mas NÃO bloqueia automaticamente - admin revisa e decide
 */

import { getFirestore } from '../lib/firebase-admin';

export interface SecurityConfig {
  shadowMode: {
    enabled: boolean;
    autoBlockThreshold: number; // 0-100: Só bloqueia automaticamente se confidence >= threshold
    requireApprovalBelow: number; // 0-100: Exige aprovação se confidence < threshold
  };
  updatedAt: string;
  updatedBy: string;
}

export interface PendingBlock {
  id: string;
  
  // Identificadores da ameaça
  uid?: string;
  ip?: string;
  deviceFingerprint?: string;
  
  // Análise AI
  aiScore: number;
  aiConfidence: number;
  aiReasoning: string;
  aiPatterns: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  threatCategory: string;
  
  // Dados do request
  route: string;
  action: string;
  userAgent?: string;
  
  // Dados da conta (se disponível)
  accountData?: {
    email?: string;
    displayName?: string;
    phoneNumber?: string;
    tenantId?: string;
    lastLogin?: string;
    accountCreated?: string;
  };
  
  // Dados do dispositivo
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
  
  // Dados da transação (se aplicável)
  transactionData?: {
    amount?: number;
    method?: string;
    velocity?: number;
  };
  
  // Status da aprovação
  status: 'pending' | 'approved' | 'rejected';
  reason: string; // Motivo do bloqueio sugerido pela IA
  
  // Metadados
  detectedAt: string;
  reviewedAt?: string;
  reviewedBy?: string; // UID do admin que revisou
  reviewNotes?: string; // Notas do admin
  
  // Resultado da aprovação
  blockedEntityId?: string; // ID do bloqueio criado se aprovado
}

export class ShadowModeManager {
  private static instance: ShadowModeManager;
  private db: FirebaseFirestore.Firestore | null = null;
  
  private constructor() {}
  
  public static getInstance(): ShadowModeManager {
    if (!ShadowModeManager.instance) {
      ShadowModeManager.instance = new ShadowModeManager();
    }
    return ShadowModeManager.instance;
  }
  
  async initialize() {
    if (this.db) return;
    this.db = getFirestore();
    
    // Criar configuração padrão se não existir
    const configDoc = await this.db.collection('securityConfig').doc('main').get();
    if (!configDoc.exists) {
      const defaultConfig: SecurityConfig = {
        shadowMode: {
          enabled: true, // Shadow mode ATIVO por padrão (segurança)
          autoBlockThreshold: 95, // Só bloqueia auto se confidence >= 95%
          requireApprovalBelow: 95, // Exige aprovação se confidence < 95%
        },
        updatedAt: new Date().toISOString(),
        updatedBy: 'SYSTEM_INIT'
      };
      
      await this.db.collection('securityConfig').doc('main').set(defaultConfig);
      console.log('✅ Shadow Mode: Configuração padrão criada (SHADOW MODE ATIVO)');
    }
  }
  
  /**
   * 🔍 VERIFICAR SE DEVE BLOQUEAR AUTOMATICAMENTE OU ENVIAR PARA APROVAÇÃO
   */
  async shouldAutoBlock(confidence: number): Promise<{ autoBlock: boolean; reason: string }> {
    await this.initialize();
    
    const configDoc = await this.db!.collection('securityConfig').doc('main').get();
    const config = configDoc.data() as SecurityConfig;
    
    // 🚫 BLOQUEIO AUTOMÁTICO DESABILITADO - SEMPRE MANUAL
    // Admin analisa logs e bloqueia manualmente via painel
    return { autoBlock: false, reason: `Sistema configurado para bloqueios 100% manuais (Confidence: ${confidence}%) - logs enviados para admin aprovar` };
  }
  
  /**
   * 📋 CRIAR BLOQUEIO PENDENTE PARA APROVAÇÃO
   */
  async createPendingBlock(data: Omit<PendingBlock, 'id' | 'status' | 'detectedAt'>): Promise<PendingBlock> {
    await this.initialize();
    
    const pendingBlock: PendingBlock = {
      ...data,
      id: `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
      detectedAt: new Date().toISOString()
    };
    
    await this.db!.collection('pendingBlocks').doc(pendingBlock.id).set(pendingBlock);
    
    console.log(`📋 BLOQUEIO PENDENTE CRIADO: ${pendingBlock.id} - Confidence: ${pendingBlock.aiConfidence}%`);
    
    return pendingBlock;
  }
  
  /**
   * ✅ APROVAR BLOQUEIO PENDENTE
   */
  async approveBlock(pendingBlockId: string, adminUid: string, notes?: string): Promise<string> {
    await this.initialize();
    
    const pendingDoc = await this.db!.collection('pendingBlocks').doc(pendingBlockId).get();
    if (!pendingDoc.exists) {
      throw new Error('Bloqueio pendente não encontrado');
    }
    
    const pendingBlock = pendingDoc.data() as PendingBlock;
    
    // Criar bloqueio real
    const { entityBlocker } = await import('./entity-blocker');
    await entityBlocker.initialize();
    
    const blockedEntity = await entityBlocker.blockEntity({
      uid: pendingBlock.uid,
      ip: pendingBlock.ip,
      deviceFingerprint: pendingBlock.deviceFingerprint,
      reason: `[APROVADO POR ADMIN] ${pendingBlock.reason}`,
      severity: pendingBlock.riskLevel === 'critical' ? 'critical' : 'high',
      blockedBy: adminUid,
      accountData: pendingBlock.accountData,
      deviceData: pendingBlock.deviceData,
      notes: JSON.stringify({
        approvedFrom: pendingBlockId,
        aiScore: pendingBlock.aiScore,
        aiConfidence: pendingBlock.aiConfidence,
        adminNotes: notes
      })
    });
    
    // Atualizar status do pendente
    await this.db!.collection('pendingBlocks').doc(pendingBlockId).update({
      status: 'approved',
      reviewedAt: new Date().toISOString(),
      reviewedBy: adminUid,
      reviewNotes: notes,
      blockedEntityId: blockedEntity.id
    });
    
    console.log(`✅ BLOQUEIO APROVADO: ${pendingBlockId} → ${blockedEntity.id}`);
    
    return blockedEntity.id;
  }
  
  /**
   * ❌ REJEITAR BLOQUEIO PENDENTE
   */
  async rejectBlock(pendingBlockId: string, adminUid: string, notes?: string): Promise<void> {
    await this.initialize();
    
    await this.db!.collection('pendingBlocks').doc(pendingBlockId).update({
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
      reviewedBy: adminUid,
      reviewNotes: notes
    });
    
    console.log(`❌ BLOQUEIO REJEITADO: ${pendingBlockId}`);
  }
  
  /**
   * 📊 OBTER BLOQUEIOS PENDENTES
   */
  async getPendingBlocks(limit: number = 50): Promise<PendingBlock[]> {
    await this.initialize();
    
    const snapshot = await this.db!.collection('pendingBlocks')
      .where('status', '==', 'pending')
      .orderBy('detectedAt', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map(doc => doc.data() as PendingBlock);
  }
  
  /**
   * ⚙️ ATUALIZAR CONFIGURAÇÃO
   */
  async updateConfig(config: Partial<SecurityConfig['shadowMode']>, adminUid: string): Promise<void> {
    await this.initialize();
    
    await this.db!.collection('securityConfig').doc('main').update({
      'shadowMode.enabled': config.enabled,
      'shadowMode.autoBlockThreshold': config.autoBlockThreshold,
      'shadowMode.requireApprovalBelow': config.requireApprovalBelow,
      updatedAt: new Date().toISOString(),
      updatedBy: adminUid
    });
    
    console.log(`⚙️ SHADOW MODE CONFIG ATUALIZADO por ${adminUid}`);
  }
  
  /**
   * 📈 OBTER CONFIGURAÇÃO ATUAL
   */
  async getConfig(): Promise<SecurityConfig> {
    await this.initialize();
    
    const configDoc = await this.db!.collection('securityConfig').doc('main').get();
    return configDoc.data() as SecurityConfig;
  }
  
  /**
   * 📊 ESTATÍSTICAS DE APROVAÇÕES
   */
  async getStats(): Promise<{
    totalPending: number;
    totalApproved: number;
    totalRejected: number;
    avgConfidenceApproved: number;
    avgConfidenceRejected: number;
  }> {
    await this.initialize();
    
    const [pendingSnap, approvedSnap, rejectedSnap] = await Promise.all([
      this.db!.collection('pendingBlocks').where('status', '==', 'pending').get(),
      this.db!.collection('pendingBlocks').where('status', '==', 'approved').get(),
      this.db!.collection('pendingBlocks').where('status', '==', 'rejected').get()
    ]);
    
    const approvedBlocks = approvedSnap.docs.map(d => d.data() as PendingBlock);
    const rejectedBlocks = rejectedSnap.docs.map(d => d.data() as PendingBlock);
    
    const avgConfidenceApproved = approvedBlocks.length > 0
      ? approvedBlocks.reduce((sum, b) => sum + b.aiConfidence, 0) / approvedBlocks.length
      : 0;
      
    const avgConfidenceRejected = rejectedBlocks.length > 0
      ? rejectedBlocks.reduce((sum, b) => sum + b.aiConfidence, 0) / rejectedBlocks.length
      : 0;
    
    return {
      totalPending: pendingSnap.size,
      totalApproved: approvedSnap.size,
      totalRejected: rejectedSnap.size,
      avgConfidenceApproved,
      avgConfidenceRejected
    };
  }
}

export const shadowModeManager = ShadowModeManager.getInstance();
