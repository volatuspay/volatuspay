// 🌍 IP INTELLIGENCE - GEOLOCALIZAÇÃO E DETECÇÃO VPS/PROXY
// Sistema avançado de análise de IPs com detecção de datacenter

import { getFirestore } from '../lib/firebase-admin';

// 📊 INTERFACE DE DADOS DE IP
export interface IPIntelligence {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
  org: string;
  as: string;
  asn: string;
  isProxy: boolean;
  isVPN: boolean;
  isDatacenter: boolean;
  isTor: boolean;
  isHosting: boolean;
  threatLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  fetchedAt: Date;
}

// 🏢 ASNs DE DATACENTERS CONHECIDOS (VPS/HOSTING)
const DATACENTER_ASNS = new Set([
  // Amazon AWS
  'AS16509', 'AS14618', 'AS7224', 'AS8987',
  // Google Cloud
  'AS15169', 'AS396982', 'AS36492', 'AS139070',
  // Microsoft Azure
  'AS8075', 'AS8068', 'AS8069', 'AS12076',
  // DigitalOcean
  'AS14061', 'AS393406', 'AS200130',
  // Linode/Akamai
  'AS63949', 'AS132892',
  // OVH
  'AS16276',
  // Vultr
  'AS20473', 'AS64515',
  // Hetzner
  'AS24940', 'AS213230',
  // Cloudflare
  'AS13335', 'AS209242',
  // Oracle Cloud
  'AS31898',
  // Alibaba Cloud
  'AS45102', 'AS37963',
  // Contabo
  'AS51167',
  // Hostinger
  'AS47583',
  // HostGator
  'AS21844', 'AS46606',
  // GoDaddy
  'AS26496', 'AS398101',
  // Bluehost
  'AS11426',
  // Rackspace
  'AS27357', 'AS12200',
  // IBM Cloud
  'AS36351',
  // Scaleway
  'AS12876',
  // Upcloud
  'AS202053',
  // LeaseWeb
  'AS60781', 'AS28753',
  // QuadraNet
  'AS8100',
  // ColoCrossing
  'AS36352',
  // Psychz Networks
  'AS40676',
  // Choopa/Vultr
  'AS20473',
  // Servers.com
  'AS136907',
  // Cherry Servers
  'AS59642',
]);

// 🌐 ISPs DE VPN/PROXY CONHECIDOS
const VPN_ISPS = new Set([
  'nordvpn',
  'expressvpn',
  'surfshark',
  'cyberghost',
  'privateinternetaccess',
  'protonvpn',
  'mullvad',
  'ivpn',
  'purevpn',
  'ipvanish',
  'hidemyass',
  'tunnelbear',
  'windscribe',
  'hotspot shield',
  'zenmate',
]);

// 🔒 CACHE EM MEMÓRIA PARA ECONOMIZAR REQUESTS
const ipCache = new Map<string, { data: IPIntelligence; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

// 📊 INTERFACE PARA RESPOSTA DA API
interface IPAPIResponse {
  status: string;
  message?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  regionName?: string;
  city?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  asname?: string;
  proxy?: boolean;
  hosting?: boolean;
  query?: string;
}

// 📡 BUSCAR INFORMAÇÕES DO IP VIA API GRATUITA
async function fetchIPInfo(ip: string): Promise<IPIntelligence | null> {
  try {
    // Verificar cache primeiro
    const cached = ipCache.get(ip);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // 🌍 API gratuita: ip-api.com (45 req/min limite)
    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,proxy,hosting,query`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      console.warn(`⚠️ IP-API retornou status ${response.status} para ${ip}`);
      return null;
    }

    const data = await response.json() as IPAPIResponse;

    if (data.status === 'fail') {
      console.warn(`⚠️ IP-API falhou para ${ip}: ${data.message}`);
      return null;
    }

    // Extrair ASN do campo "as" (ex: "AS16509 Amazon.com, Inc.")
    const asn = data.as?.split(' ')[0] || '';

    // Detectar se é datacenter/VPN
    const isDatacenter = DATACENTER_ASNS.has(asn) || data.hosting === true;
    const isVPN = VPN_ISPS.has(data.isp?.toLowerCase()) || 
                  data.org?.toLowerCase().includes('vpn') ||
                  data.isp?.toLowerCase().includes('vpn');
    const isProxy = data.proxy === true || isVPN;
    const isTor = data.isp?.toLowerCase().includes('tor') || 
                  data.org?.toLowerCase().includes('tor exit');

    // Calcular risk score
    let riskScore = 0;
    if (isDatacenter) riskScore += 30;
    if (isVPN) riskScore += 40;
    if (isProxy) riskScore += 35;
    if (isTor) riskScore += 50;
    if (data.hosting) riskScore += 25;

    // Determinar threat level
    let threatLevel: IPIntelligence['threatLevel'] = 'safe';
    if (riskScore >= 80) threatLevel = 'critical';
    else if (riskScore >= 60) threatLevel = 'high';
    else if (riskScore >= 40) threatLevel = 'medium';
    else if (riskScore >= 20) threatLevel = 'low';

    const intelligence: IPIntelligence = {
      ip: data.query || ip,
      country: data.country || 'Unknown',
      countryCode: data.countryCode || 'XX',
      region: data.regionName || '',
      city: data.city || 'Unknown',
      zip: data.zip || '',
      lat: data.lat || 0,
      lon: data.lon || 0,
      timezone: data.timezone || '',
      isp: data.isp || 'Unknown',
      org: data.org || '',
      as: data.as || '',
      asn: asn,
      isProxy,
      isVPN,
      isDatacenter,
      isTor,
      isHosting: data.hosting === true,
      threatLevel,
      riskScore,
      fetchedAt: new Date(),
    };

    // Salvar no cache
    ipCache.set(ip, {
      data: intelligence,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return intelligence;
  } catch (error) {
    console.error(`❌ Erro ao buscar info do IP ${ip}:`, error);
    return null;
  }
}

// 🔍 ANALISAR IP COM INTELIGÊNCIA COMPLETA
export async function analyzeIP(ip: string): Promise<IPIntelligence | null> {
  // Ignorar IPs locais/privados
  if (isPrivateIP(ip)) {
    return {
      ip,
      country: 'Local',
      countryCode: 'LO',
      region: '',
      city: 'Local Network',
      zip: '',
      lat: 0,
      lon: 0,
      timezone: '',
      isp: 'Local',
      org: 'Private Network',
      as: '',
      asn: '',
      isProxy: false,
      isVPN: false,
      isDatacenter: false,
      isTor: false,
      isHosting: false,
      threatLevel: 'safe',
      riskScore: 0,
      fetchedAt: new Date(),
    };
  }

  return fetchIPInfo(ip);
}

// 🏠 VERIFICAR SE IP É PRIVADO
function isPrivateIP(ip: string): boolean {
  // IPv4 privados
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (ip === '::1') return true;
  if (/^::ffff:127\./.test(ip)) return true;
  // Replit ranges
  if (/^160\.20\./.test(ip)) return true;
  if (/^100\.64\./.test(ip)) return true;
  return false;
}

// 💾 SALVAR ANÁLISE NO FIRESTORE
export async function saveIPAnalysis(intel: IPIntelligence): Promise<void> {
  try {
    const db = getFirestore();
    await db.collection('ipIntelligence').doc(intel.ip.replace(/\./g, '_')).set({
      ...intel,
      fetchedAt: intel.fetchedAt.toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (error) {
    console.error('❌ Erro ao salvar análise de IP:', error);
  }
}

// 📊 OBTER ESTATÍSTICAS DE IPs ANALISADOS
export async function getIPStats(): Promise<{
  total: number;
  byCountry: Record<string, number>;
  byThreatLevel: Record<string, number>;
  datacenters: number;
  proxies: number;
}> {
  try {
    const db = getFirestore();
    const snapshot = await db.collection('ipIntelligence').get();
    
    const stats = {
      total: 0,
      byCountry: {} as Record<string, number>,
      byThreatLevel: {} as Record<string, number>,
      datacenters: 0,
      proxies: 0,
    };

    snapshot.forEach(doc => {
      const data = doc.data();
      stats.total++;
      
      const country = data.countryCode || 'XX';
      stats.byCountry[country] = (stats.byCountry[country] || 0) + 1;
      
      const threat = data.threatLevel || 'unknown';
      stats.byThreatLevel[threat] = (stats.byThreatLevel[threat] || 0) + 1;
      
      if (data.isDatacenter) stats.datacenters++;
      if (data.isProxy || data.isVPN) stats.proxies++;
    });

    return stats;
  } catch (error) {
    console.error('❌ Erro ao obter stats de IPs:', error);
    return { total: 0, byCountry: {}, byThreatLevel: {}, datacenters: 0, proxies: 0 };
  }
}

// 🧹 LIMPAR CACHE EXPIRADO
export function cleanExpiredCache(): number {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [ip, cached] of ipCache.entries()) {
    if (cached.expiresAt < now) {
      ipCache.delete(ip);
      cleaned++;
    }
  }
  
  return cleaned;
}

// Limpar cache a cada hora
setInterval(() => {
  const cleaned = cleanExpiredCache();
  if (cleaned > 0) {
    console.log(`🧹 IP Cache: ${cleaned} entradas expiradas removidas`);
  }
}, 60 * 60 * 1000);

// 📤 EXPORTAR FUNÇÕES
export const ipIntelligence = {
  analyze: analyzeIP,
  save: saveIPAnalysis,
  getStats: getIPStats,
  isPrivate: isPrivateIP,
  cleanCache: cleanExpiredCache,
  getCacheSize: () => ipCache.size,
};

export default ipIntelligence;
