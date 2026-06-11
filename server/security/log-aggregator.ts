/**
 * 🧮 LOG AGGREGATOR - SISTEMA INTELIGENTE DE AGREGAÇÃO DE LOGS
 * 
 * Agrupa logs similares para evitar spam no dashboard e reduzir custos do Firestore
 * - Detecta ataques repetidos (mesmo IP + tipo + período)
 * - Salva apenas ataques CONFIRMADOS (não falsos positivos)
 * - Retorna logs agregados com contadores (ex: "3x Rate Limit")
 */

import { getAdmin } from '../lib/firebase-admin';
import { saveDataToBunny } from '../lib/bunny-data-storage.js';

interface LogEntry {
  id: string;
  ipAddress: string;
  threatCategory: string;
  severity: string;
  endpoint: string;
  userAgent: string;
  detectedAt: Date;
  riskScore: number;
  actionTaken: string;
  evidence?: string;
  count?: number; // Contador de ocorrências agregadas
  firstDetectedAt?: Date;
  lastDetectedAt?: Date;
}

interface AggregationKey {
  ip: string;
  category: string;
  endpoint: string;
  timeWindow: string; // Janela de 1 hora
}

class LogAggregator {
  private static instance: LogAggregator;
  
  // Cache em memória para agregação (válido por 1 hora)
  private aggregationCache = new Map<string, {
    entry: LogEntry;
    count: number;
    firstSeen: Date;
    lastSeen: Date;
    savedToFirestore: boolean;
  }>();
  
  // Limpar cache a cada hora
  constructor() {
    setInterval(() => this.cleanup(), 60 * 60 * 1000); // 1 hora
  }
  
  public static getInstance(): LogAggregator {
    if (!LogAggregator.instance) {
      LogAggregator.instance = new LogAggregator();
    }
    return LogAggregator.instance;
  }
  
  /**
   * 🔑 GERAR CHAVE DE AGREGAÇÃO
   * Logs similares (mesmo IP + categoria + endpoint + janela temporal) são agrupados
   */
  private generateAggregationKey(entry: LogEntry): string {
    const timeWindow = Math.floor(entry.detectedAt.getTime() / (60 * 60 * 1000)); // Janela de 1 hora
    return `${entry.ipAddress}|${entry.threatCategory}|${entry.endpoint}|${timeWindow}`;
  }
  
  /**
   * 🚨 VERIFICAR SE É ATAQUE CONFIRMADO (não falso positivo)
   */
  private isConfirmedAttack(entry: LogEntry): boolean {
    const confirmedCategories = [
      'xss_injection',
      'sql_injection',
      'html_injection',
      'path_traversal',
      'code_injection',
      'idor_violation',
      'privilege_escalation',
      'ddos_attack',
      'rate_limit_exceeded',
      'brute_force',
      'bot_attack',
      'suspicious_behavior'
    ];
    
    const confirmedActions = [
      'block_immediate',
      'block_permanent'
    ];
    
    // Ataque confirmado se:
    // 1. Categoria crítica (injection, etc)
    // 2. Ação de bloqueio imediato
    // 3. Risk score >= 50 (lowered from 80 — medium+ sempre salva)
    // 4. Severidade medium, high ou critical
    const confirmedSeverities = ['medium', 'high', 'critical'];
    return (
      confirmedCategories.includes(entry.threatCategory) ||
      confirmedActions.includes(entry.actionTaken) ||
      entry.riskScore >= 50 ||
      confirmedSeverities.includes((entry as any).severity || '')
    );
  }
  
  /**
   * 📝 ADICIONAR LOG COM AGREGAÇÃO INTELIGENTE
   * - Agrupa logs similares
   * - Salva no Firestore apenas ataques confirmados OU primeira ocorrência
   */
  public async addLog(entry: LogEntry): Promise<void> {
    const key = this.generateAggregationKey(entry);
    const cached = this.aggregationCache.get(key);
    
    if (cached) {
      // Log similar já existe - apenas incrementar contador
      cached.count++;
      cached.lastSeen = entry.detectedAt;
      
      console.log(`📊 LOG AGREGADO: ${entry.threatCategory} de ${entry.ipAddress} - Total: ${cached.count}x`);
      
      // Salvar no Firestore a cada 10 ocorrências OU se for ataque confirmado
      const shouldSave = 
        (cached.count % 10 === 0) || 
        this.isConfirmedAttack(entry);
      
      if (shouldSave && !cached.savedToFirestore) {
        await this.saveToFirestore({
          ...entry,
          count: cached.count,
          firstDetectedAt: cached.firstSeen,
          lastDetectedAt: cached.lastSeen
        });
        cached.savedToFirestore = true;
      }
    } else {
      // Primeiro log deste tipo - adicionar ao cache
      this.aggregationCache.set(key, {
        entry,
        count: 1,
        firstSeen: entry.detectedAt,
        lastSeen: entry.detectedAt,
        savedToFirestore: false
      });
      
      // Salvar IMEDIATAMENTE se for ataque confirmado
      if (this.isConfirmedAttack(entry)) {
        console.log(`🚨 ATAQUE CONFIRMADO DETECTADO: ${entry.threatCategory} de ${entry.ipAddress} - Salvando no Firestore`);
        await this.saveToFirestore({
          ...entry,
          count: 1,
          firstDetectedAt: entry.detectedAt,
          lastDetectedAt: entry.detectedAt
        });
        this.aggregationCache.get(key)!.savedToFirestore = true;
      } else {
        console.log(`📋 LOG EM CACHE: ${entry.threatCategory} de ${entry.ipAddress} - Aguardando agregação`);
      }
    }
  }
  
  /**
   * 💾 SALVAR NO FIRESTORE (apenas ataques confirmados)
   */
  private async saveToFirestore(entry: LogEntry): Promise<void> {
    try {
      const admin = await getAdmin();
      const db = admin.firestore();
      
      const logData = {
        id: entry.id,
        ipAddress: entry.ipAddress,
        threatCategory: entry.threatCategory,
        severity: entry.severity,
        endpoint: entry.endpoint,
        userAgent: entry.userAgent,
        detectedAt: entry.detectedAt,
        riskScore: entry.riskScore,
        actionTaken: entry.actionTaken,
        evidence: entry.evidence || '',
        count: entry.count || 1,
        firstDetectedAt: entry.firstDetectedAt || entry.detectedAt,
        lastDetectedAt: entry.lastDetectedAt || entry.detectedAt,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      saveDataToBunny('logs/security', entry.id, logData)
        .then(r => r.success && console.log(`☁️ Security log ${entry.id} salvo no Bunny`))
        .catch(err => console.error('⚠️ Bunny security log error:', err));

      const lightweightIndex = {
        id: entry.id,
        timestamp: entry.detectedAt,
        ip: entry.ipAddress,
        threatCategory: entry.threatCategory,
        severity: entry.severity,
        count: entry.count || 1,
        endpoint: entry.endpoint
      };
      
      await db.collection('securityLogs').doc(entry.id).set(lightweightIndex);
      console.log(`💾 LOG INDEX SALVO NO FIRESTORE: ${entry.id} (${entry.count}x ocorrências)`);

      // 🐘 DUAL-WRITE → Neon (fire-and-forget, não bloqueia)
      import('../lib/neon-security.js').then(({ neonWriteSecurityLog }) => {
        neonWriteSecurityLog({
          id: entry.id,
          ipAddress: entry.ipAddress,
          threatCategory: entry.threatCategory,
          severity: entry.severity,
          endpoint: entry.endpoint,
          userAgent: entry.userAgent,
          riskScore: entry.riskScore,
          actionTaken: entry.actionTaken,
          evidence: entry.evidence,
          blocked: (entry as any).blocked ?? false,
          count: entry.count ?? 1,
          firstDetectedAt: entry.firstDetectedAt,
          lastDetectedAt: entry.lastDetectedAt,
          detectedAt: entry.detectedAt,
        });
      }).catch(() => {});
    } catch (error) {
      console.error('❌ Erro ao salvar log no Firestore:', error);
    }
  }
  
  /**
   * 📊 OBTER LOGS AGREGADOS PARA DASHBOARD
   * Retorna logs únicos com contadores de ocorrências
   */
  public async getAggregatedLogs(filters?: {
    category?: string;
    severity?: string;
    limit?: number;
  }): Promise<LogEntry[]> {
    try {
      const admin = await getAdmin();
      const db = admin.firestore();
      
      let query: any = db.collection('securityLogs')
        .orderBy('detectedAt', 'desc')
        .limit(filters?.limit || 50);
      
      if (filters?.category && filters.category !== 'all') {
        query = query.where('threatCategory', '==', filters.category);
      }
      
      if (filters?.severity && filters.severity !== 'all') {
        query = query.where('severity', '==', filters.severity);
      }
      
      const snapshot = await query.get();
      const logs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          detectedAt: data.detectedAt?.toDate?.() || new Date(data.detectedAt),
          firstDetectedAt: data.firstDetectedAt?.toDate?.() || data.detectedAt?.toDate?.() || new Date(data.detectedAt),
          lastDetectedAt: data.lastDetectedAt?.toDate?.() || data.detectedAt?.toDate?.() || new Date(data.detectedAt),
          count: data.count || 1
        } as LogEntry;
      });
      
      console.log(`📊 LOGS AGREGADOS: ${logs.length} entradas únicas retornadas`);
      return logs;
    } catch (error) {
      console.error('❌ Erro ao buscar logs agregados:', error);
      return [];
    }
  }
  
  /**
   * 🧹 LIMPAR CACHE ANTIGO (mais de 1 hora)
   */
  private cleanup(): void {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    let removed = 0;
    
    for (const [key, cached] of this.aggregationCache.entries()) {
      if (cached.lastSeen.getTime() < oneHourAgo) {
        // Salvar logs não salvos antes de remover do cache
        if (!cached.savedToFirestore && cached.count >= 3) {
          this.saveToFirestore({
            ...cached.entry,
            count: cached.count,
            firstDetectedAt: cached.firstSeen,
            lastDetectedAt: cached.lastSeen
          }).catch(err => console.error('❌ Erro ao salvar log no cleanup:', err));
        }
        
        this.aggregationCache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`🧹 Limpeza de cache: ${removed} entradas antigas removidas`);
    }
  }
  
  /**
   * 📈 ESTATÍSTICAS DO AGREGADOR
   */
  public getStats(): {
    cachedEntries: number;
    totalOccurrences: number;
    confirmedAttacks: number;
  } {
    let totalOccurrences = 0;
    let confirmedAttacks = 0;
    
    for (const cached of this.aggregationCache.values()) {
      totalOccurrences += cached.count;
      if (this.isConfirmedAttack(cached.entry)) {
        confirmedAttacks++;
      }
    }
    
    return {
      cachedEntries: this.aggregationCache.size,
      totalOccurrences,
      confirmedAttacks
    };
  }
}

export const logAggregator = LogAggregator.getInstance();
