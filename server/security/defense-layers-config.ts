// 🛡️ DEFENSE IN DEPTH - 4 LAYERS CONFIGURATION
// Sistema de controle granular para Edge Firewall, WAF, IDS/IPS, e Threat Intelligence
// Permite ativar/desativar cada camada e funcionalidade individualmente

import { edgeFW } from './edge-firewall.js';
import { waf } from './waf.js';
import { idsips } from './ids-ips.js';
import { threatIntelligence } from './threat-intelligence.js';

// 🎯 CONFIGURAÇÃO DAS 4 CAMADAS
export interface DefenseLayersConfig {
  // Layer 1: Edge Firewall
  edgeFirewall: {
    enabled: boolean;
    ipReputation: boolean;
    geoBlocking: boolean;
    asnBlocking: boolean;
    torBlocking: boolean;
    vpnBlocking: boolean;
  };

  // Layer 2: WAF
  waf: {
    enabled: boolean;
    blockMode: boolean; // true = block, false = detect only
  };

  // Layer 3: IDS/IPS
  idsips: {
    enabled: boolean;
    honeypot: boolean;
    correlation: boolean;
  };

  // Layer 4: Threat Intelligence
  threatIntel: {
    enabled: boolean;
    zeroDayDetection: boolean;
    autoResponse: boolean;
  };
}

// 🌍 CONFIGURAÇÃO ATUAL (Singleton) - MODO MINIMAL PARA NÃO BLOQUEAR USUÁRIOS
let currentConfig: DefenseLayersConfig = {
  edgeFirewall: {
    enabled: true,
    ipReputation: false, // ✅ DESATIVADO - Não bloquear IPs legítimos
    geoBlocking: false, // Desativado por padrão (pode bloquear usuários legítimos)
    asnBlocking: false, // ✅ DESATIVADO - Não bloquear ASNs legítimos
    torBlocking: false, // ✅ DESATIVADO - Apenas detectar, não bloquear
    vpnBlocking: false, // Desativado por padrão (muitos usuários legítimos usam VPN)
  },
  waf: {
    enabled: true,
    blockMode: false, // ✅ DETECTION-ONLY: Log threats mas NÃO bloqueia
  },
  idsips: {
    enabled: true,
    honeypot: false, // ✅ DESATIVADO - Não bloquear honeypots
    correlation: true,
  },
  threatIntel: {
    enabled: true,
    zeroDayDetection: true,
    autoResponse: false, // ✅ DETECTION-ONLY: Log threats mas NÃO bloqueia
  },
};

// 📊 ESTATÍSTICAS DE BLOQUEIOS POR CAMADA
export interface DefenseStats {
  edgeFirewall: {
    totalRequests: number;
    totalBlocked: number;
    byReason: Record<string, number>;
  };
  waf: {
    totalRequests: number;
    totalBlocked: number;
    byAttackType: Record<string, number>;
  };
  idsips: {
    totalRequests: number;
    honeypotHits: number;
    correlatedAttacks: number;
  };
  threatIntel: {
    totalRequests: number;
    totalBlocked: number;
    byAction: Record<string, number>;
  };
}

let defenseStats: DefenseStats = {
  edgeFirewall: { totalRequests: 0, totalBlocked: 0, byReason: {} },
  waf: { totalRequests: 0, totalBlocked: 0, byAttackType: {} },
  idsips: { totalRequests: 0, honeypotHits: 0, correlatedAttacks: 0 },
  threatIntel: { totalRequests: 0, totalBlocked: 0, byAction: {} },
};

// 🎛️ GETTERS
export function getDefenseConfig(): DefenseLayersConfig {
  return JSON.parse(JSON.stringify(currentConfig));
}

export function getDefenseStats(): DefenseStats {
  return JSON.parse(JSON.stringify(defenseStats));
}

// 🎛️ SETTERS
export function updateDefenseConfig(newConfig: Partial<DefenseLayersConfig>): void {
  // Merge deep
  if (newConfig.edgeFirewall) {
    currentConfig.edgeFirewall = { ...currentConfig.edgeFirewall, ...newConfig.edgeFirewall };
    applyEdgeFirewallConfig();
  }
  if (newConfig.waf) {
    currentConfig.waf = { ...currentConfig.waf, ...newConfig.waf };
    applyWAFConfig();
  }
  if (newConfig.idsips) {
    currentConfig.idsips = { ...currentConfig.idsips, ...newConfig.idsips };
    applyIDSIPSConfig();
  }
  if (newConfig.threatIntel) {
    currentConfig.threatIntel = { ...currentConfig.threatIntel, ...newConfig.threatIntel };
    applyThreatIntelConfig();
  }

  console.log('🔧 Defense Layers Config Updated:', JSON.stringify(currentConfig, null, 2));
}

// 🔄 APLICAR CONFIGURAÇÕES NAS CAMADAS
function applyEdgeFirewallConfig() {
  const cfg = currentConfig.edgeFirewall;
  edgeFW.setEnabled(cfg.enabled);
  edgeFW.setIPReputation(cfg.ipReputation);
  edgeFW.setGeoBlocking(cfg.geoBlocking);
  edgeFW.setASNBlocking(cfg.asnBlocking);
  edgeFW.setTorBlocking(cfg.torBlocking);
  edgeFW.setVPNBlocking(cfg.vpnBlocking);
}

function applyWAFConfig() {
  const cfg = currentConfig.waf;
  waf.setEnabled(cfg.enabled);
  waf.setBlockMode(cfg.blockMode);
}

function applyIDSIPSConfig() {
  const cfg = currentConfig.idsips;
  idsips.setEnabled(cfg.enabled);
  idsips.setHoneypot(cfg.honeypot);
  idsips.setCorrelation(cfg.correlation);
}

function applyThreatIntelConfig() {
  const cfg = currentConfig.threatIntel;
  threatIntelligence.setEnabled(cfg.enabled);
  threatIntelligence.setZeroDayDetection(cfg.zeroDayDetection);
  threatIntelligence.setAutoResponse(cfg.autoResponse);
}

// 📊 TRACKING DE ESTATÍSTICAS
export function incrementEdgeFirewallRequest() {
  defenseStats.edgeFirewall.totalRequests++;
}

export function incrementEdgeFirewallBlock(reason: string) {
  defenseStats.edgeFirewall.totalBlocked++;
  defenseStats.edgeFirewall.byReason[reason] = 
    (defenseStats.edgeFirewall.byReason[reason] || 0) + 1;
}

export function incrementWAFRequest() {
  defenseStats.waf.totalRequests++;
}

export function incrementWAFBlock(attackType: string) {
  defenseStats.waf.totalBlocked++;
  defenseStats.waf.byAttackType[attackType] = 
    (defenseStats.waf.byAttackType[attackType] || 0) + 1;
}

export function incrementIDSIPSRequest() {
  defenseStats.idsips.totalRequests++;
}

export function incrementHoneypotHit() {
  defenseStats.idsips.honeypotHits++;
}

export function incrementCorrelatedAttack() {
  defenseStats.idsips.correlatedAttacks++;
}

export function incrementThreatIntelRequest() {
  defenseStats.threatIntel.totalRequests++;
}

export function incrementThreatIntelBlock(action: string) {
  defenseStats.threatIntel.totalBlocked++;
  defenseStats.threatIntel.byAction[action] = 
    (defenseStats.threatIntel.byAction[action] || 0) + 1;
}

// 🔄 RESET STATS
export function resetDefenseStats() {
  defenseStats = {
    edgeFirewall: { totalRequests: 0, totalBlocked: 0, byReason: {} },
    waf: { totalRequests: 0, totalBlocked: 0, byAttackType: {} },
    idsips: { totalRequests: 0, honeypotHits: 0, correlatedAttacks: 0 },
    threatIntel: { totalRequests: 0, totalBlocked: 0, byAction: {} },
  };
  console.log('🔄 Defense Stats Reset');
}

// 🎯 PRESETS RÁPIDOS
export const DEFENSE_PRESETS = {
  // 🔥 Máxima segurança (bloqueia tudo)
  MAXIMUM: {
    edgeFirewall: {
      enabled: true,
      ipReputation: true,
      geoBlocking: true,
      asnBlocking: true,
      torBlocking: true,
      vpnBlocking: true,
    },
    waf: {
      enabled: true,
      blockMode: true,
    },
    idsips: {
      enabled: true,
      honeypot: true,
      correlation: true,
    },
    threatIntel: {
      enabled: true,
      zeroDayDetection: true,
      autoResponse: true,
    },
  },

  // ⚖️ Balanceado (padrão recomendado)
  BALANCED: {
    edgeFirewall: {
      enabled: true,
      ipReputation: true,
      geoBlocking: false,
      asnBlocking: true,
      torBlocking: true,
      vpnBlocking: false,
    },
    waf: {
      enabled: true,
      blockMode: true,
    },
    idsips: {
      enabled: true,
      honeypot: true,
      correlation: true,
    },
    threatIntel: {
      enabled: true,
      zeroDayDetection: true,
      autoResponse: true,
    },
  },

  // 🟢 Mínimo (apenas detecção, sem bloqueios)
  MINIMAL: {
    edgeFirewall: {
      enabled: true,
      ipReputation: false, // ✅ DESATIVADO - Não bloquear IPs legítimos
      geoBlocking: false,
      asnBlocking: false,
      torBlocking: false,
      vpnBlocking: false,
    },
    waf: {
      enabled: true,
      blockMode: false, // Detect only
    },
    idsips: {
      enabled: true,
      honeypot: false,
      correlation: true,
    },
    threatIntel: {
      enabled: true,
      zeroDayDetection: true,
      autoResponse: false,
    },
  },

  // 🔓 Desabilitado (apenas para testes)
  DISABLED: {
    edgeFirewall: {
      enabled: false,
      ipReputation: false,
      geoBlocking: false,
      asnBlocking: false,
      torBlocking: false,
      vpnBlocking: false,
    },
    waf: {
      enabled: false,
      blockMode: false,
    },
    idsips: {
      enabled: false,
      honeypot: false,
      correlation: false,
    },
    threatIntel: {
      enabled: false,
      zeroDayDetection: false,
      autoResponse: false,
    },
  },
};

// 🎯 APLICAR PRESET
export function applyDefensePreset(preset: keyof typeof DEFENSE_PRESETS): void {
  currentConfig = JSON.parse(JSON.stringify(DEFENSE_PRESETS[preset]));
  
  // Aplicar em todas as camadas
  applyEdgeFirewallConfig();
  applyWAFConfig();
  applyIDSIPSConfig();
  applyThreatIntelConfig();
  
  console.log(`🎯 Defense Preset Applied: ${preset}`);
}

// 🚀 INICIALIZAÇÃO (aplicar config atual)
export function initializeDefenseLayers() {
  console.log('🛡️ INITIALIZING DEFENSE IN DEPTH - 4 LAYERS...');
  
  applyEdgeFirewallConfig();
  applyWAFConfig();
  applyIDSIPSConfig();
  applyThreatIntelConfig();
  
  console.log('✅ DEFENSE LAYERS INITIALIZED:', JSON.stringify(currentConfig, null, 2));
}
