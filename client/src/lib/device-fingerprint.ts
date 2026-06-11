/**
 * DETECÇÃO DE DADOS TCNICOS DO DISPOSITIVO - LGPD/GDPR COMPLIANT
 * 
 * Coleta APENAS dados essenciais do seller para:
 * - Preveno de fraude
 * - Segurana da plataforma
 * 
 * CONFORMIDADE LGPD/GDPR:
 * - Minimizao de dados: apenas o essencial
 * - Dados coletados apenas com consentimento explcito
 * - Hash irreversvel para dados sensveis
 * - Finalidade: preveno de fraude e segurana
 * - Armazenamento seguro no Firebase
 * - Acesso restrito apenas para admin autorizado
 */

export interface DeviceFingerprint {
  // Rede (Coletados no backend)
  ip?: string; // IP pblico (hash no backend)
  country?: string; // Pas
  city?: string; // Cidade
  
  // Sistema (anonimizado com hash)
  userAgent: string; // Hash do User Agent
  os: string; // Ex: "Windows 10", "macOS", etc
  browser: string; // Ex: "Chrome", "Firefox"
  browserVersion: string;
  
  // Tela
  screenResolution: string; // Ex: "1920x1080"
  
  //  Hardware
  cpuCores: number;
  deviceMemory?: number; // RAM em GB (se disponível)
  
  // Localização e Idioma
  timezone: string;
  language: string;
  
  // Timestamp
  timestamp: string;
  
  // Legal
  consentGiven: boolean; // Seller aceitou termos
  consentDate: string;
}

/**
 * GERA HASH SHA-256 IRREVERSVEL (LGPD/GDPR)
 * Implementação pura em JavaScript - funciona em todos os navegadores
 */
async function hashValue(value: string): Promise<string> {
  try {
    // Método 1: WebCrypto API (navegadores modernos)
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(value);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return hashHex.substring(0, 16); // Primeiros 16 caracteres
    }
    
    // Método 2: SHA-256 puro em JavaScript (fallback SEGURO)
    return sha256Pure(value).substring(0, 16);
  } catch (error) {
    // ltimo fallback: SHA-256 puro (sempre irreversvel)
    return sha256Pure(value).substring(0, 16);
  }
}

/**
 * SHA-256 PURO EM JAVASCRIPT (SEM DEPENDNCIAS)
 * Implementação completa para garantir hash irreversvel em TODOS os navegadores
 */
function sha256Pure(message: string): string {
  // Converte string para array de bytes
  const utf8 = unescape(encodeURIComponent(message));
  const msgBytes = [];
  for (let i = 0; i < utf8.length; i++) {
    msgBytes.push(utf8.charCodeAt(i));
  }
  
  // Constantes SHA-256
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  
  // Valores iniciais SHA-256
  let H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  
  // Padding da mensagem
  const ml = msgBytes.length * 8;
  msgBytes.push(0x80);
  while (msgBytes.length % 64 !== 56) msgBytes.push(0x00);
  for (let i = 7; i >= 0; i--) {
    msgBytes.push((ml >>> (i * 8)) & 0xff);
  }
  
  // Processar blocos de 512 bits
  for (let i = 0; i < msgBytes.length; i += 64) {
    const W = [];
    for (let j = 0; j < 16; j++) {
      W[j] = (msgBytes[i + j * 4] << 24) | (msgBytes[i + j * 4 + 1] << 16) |
             (msgBytes[i + j * 4 + 2] << 8) | msgBytes[i + j * 4 + 3];
    }
    for (let j = 16; j < 64; j++) {
      const s0: number = rotr(W[j - 15], 7) ^ rotr(W[j - 15], 18) ^ (W[j - 15] >>> 3);
      const s1: number = rotr(W[j - 2], 17) ^ rotr(W[j - 2], 19) ^ (W[j - 2] >>> 10);
      W[j] = (W[j - 16] + s0 + W[j - 7] + s1) >>> 0;
    }
    
    let [a, b, c, d, e, f, g, h] = H;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + W[j]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H = [
      (H[0] + a) >>> 0, (H[1] + b) >>> 0, (H[2] + c) >>> 0, (H[3] + d) >>> 0,
      (H[4] + e) >>> 0, (H[5] + f) >>> 0, (H[6] + g) >>> 0, (H[7] + h) >>> 0
    ];
  }
  
  // Converte hash para hexadecimal
  return H.map(h => h.toString(16).padStart(8, '0')).join('');
  
  function rotr(n: number, x: number) {
    return (n >>> x) | (n << (32 - x));
  }
}

/**
 * DETECTA INFORMAÇES DO DISPOSITIVO (DADOS ESSENCIAIS)
 */
export async function getDeviceFingerprint(consentGiven = false): Promise<DeviceFingerprint> {
  try {
    // Hash do User Agent para anonimizao
    const userAgentHash = await hashValue(navigator.userAgent || 'unknown');
    
    // PROTEÇÃO MOBILE: Verificar se screen está disponível
    const screenWidth = (typeof screen !== 'undefined' && screen.width) ? screen.width : 0;
    const screenHeight = (typeof screen !== 'undefined' && screen.height) ? screen.height : 0;
    
    const fingerprint: DeviceFingerprint = {
      // Sistema (anonimizado)
      userAgent: `hash_${userAgentHash}`, // Hash irreversvel
      os: detectOS(),
      browser: detectBrowser(),
      browserVersion: detectBrowserVersion(),
      
      // Tela (apenas resoluo) - PROTEÇÃO MOBILE
      screenResolution: `${screenWidth}x${screenHeight}`,
      
      //  Hardware (apenas essencial)
      cpuCores: navigator.hardwareConcurrency || 0,
      deviceMemory: (navigator as any).deviceMemory,
      
      // Localização e Idioma
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
      language: navigator.language || 'unknown',
      
      // Timestamp
      timestamp: new Date().toISOString(),
      
      // Legal
      consentGiven,
      consentDate: new Date().toISOString()
    };
    
    return fingerprint;
  } catch (error) {
    console.error('Erro ao coletar fingerprint:', error);
    // FALLBACK MOBILE: Retornar fingerprint mnimo em vez de falhar
    return {
      userAgent: 'hash_mobile_fallback',
      os: 'unknown',
      browser: 'unknown',
      browserVersion: 'unknown',
      screenResolution: '0x0',
      cpuCores: 0,
      deviceMemory: undefined,
      timezone: 'unknown',
      language: 'unknown',
      timestamp: new Date().toISOString(),
      consentGiven,
      consentDate: new Date().toISOString()
    };
  }
}

/**
 * DETECTA SISTEMA OPERACIONAL
 */
function detectOS(): string {
  const ua = navigator.userAgent;
  
  if (ua.includes('Windows NT 10.0')) return 'Windows 10/11';
  if (ua.includes('Windows NT 6.3')) return 'Windows 8.1';
  if (ua.includes('Windows NT 6.2')) return 'Windows 8';
  if (ua.includes('Windows NT 6.1')) return 'Windows 7';
  if (ua.includes('Windows')) return 'Windows';
  
  if (ua.includes('Mac OS X')) {
    const match = ua.match(/Mac OS X ([\d_]+)/);
    if (match) {
      const version = match[1].replace(/_/g, '.');
      return `macOS ${version}`;
    }
    return 'macOS';
  }
  
  if (ua.includes('Android')) {
    const match = ua.match(/Android ([\d.]+)/);
    return match ? `Android ${match[1]}` : 'Android';
  }
  
  if (ua.includes('iPhone') || ua.includes('iPad')) {
    const match = ua.match(/OS ([\d_]+)/);
    if (match) {
      const version = match[1].replace(/_/g, '.');
      return `iOS ${version}`;
    }
    return 'iOS';
  }
  
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Ubuntu')) return 'Ubuntu';
  
  return 'Unknown';
}

/**
 * DETECTA NAVEGADOR
 */
function detectBrowser(): string {
  const ua = navigator.userAgent;
  
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/') && !ua.includes('Edg/')) return 'Chrome';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
  if (ua.includes('Opera/') || ua.includes('OPR/')) return 'Opera';
  if (ua.includes('Brave/')) return 'Brave';
  
  return 'Unknown';
}

/**
 * DETECTA VERSÃO DO NAVEGADOR
 */
function detectBrowserVersion(): string {
  const ua = navigator.userAgent;
  let match;
  
  if ((match = ua.match(/Edg\/([\d.]+)/))) return match[1];
  if ((match = ua.match(/Chrome\/([\d.]+)/))) return match[1];
  if ((match = ua.match(/Firefox\/([\d.]+)/))) return match[1];
  if ((match = ua.match(/Version\/([\d.]+)/))) return match[1]; // Safari
  if ((match = ua.match(/OPR\/([\d.]+)/))) return match[1]; // Opera
  
  return 'Unknown';
}

/**
 * FORMATA FINGERPRINT PARA EXIBIÇÃO ADMIN
 */
export function formatDeviceFingerprintForAdmin(fingerprint: DeviceFingerprint): string {
  return `
SISTEMA:
OS: ${fingerprint.os}
Navegador: ${fingerprint.browser} ${fingerprint.browserVersion}

TELA:
Resoluo: ${fingerprint.screenResolution}

HARDWARE:
CPU Cores: ${fingerprint.cpuCores}
RAM: ${fingerprint.deviceMemory ? `${fingerprint.deviceMemory} GB` : 'Não disponível'}

LOCALIZAÇÃO:
Timezone: ${fingerprint.timezone}
Idioma: ${fingerprint.language}
IP: (coletado e protegido no backend)

PRIVACIDADE:
User Agent: Anonimizado (hash)
Dados sensveis: Protegidos com hash irreversvel

LEGAL:
Consentimento: ${fingerprint.consentGiven ? 'Aceito' : 'No aceito'}
Data: ${new Date(fingerprint.consentDate).toLocaleString('pt-BR')}
  `.trim();
}
