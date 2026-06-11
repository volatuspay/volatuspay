import crypto from 'crypto';

export interface GeoLocation {
  country?: string;
  countryCode?: string;
  state?: string;
  stateCode?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

interface IPApiResponse {
  status?: string;
  message?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
}

export async function getGeoLocationFromIP(ip: string): Promise<GeoLocation | null> {
  try {
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return null;
    }

    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,regionName,city,lat,lon,timezone`);
    
    if (!response.ok) {
      console.error('[Geolocation] API error:', response.status);
      return null;
    }

    const data: IPApiResponse = await response.json();
    
    if (data.status !== 'success') {
      console.warn('[Geolocation] Failed for IP:', ip, data.message);
      return null;
    }

    return {
      country: data.country,
      countryCode: data.countryCode,
      state: data.regionName,
      stateCode: data.region,
      city: data.city,
      latitude: data.lat,
      longitude: data.lon,
      timezone: data.timezone,
    };
  } catch (error) {
    console.error('[Geolocation] Error:', error);
    return null;
  }
}

export function hashIP(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

export function getClientIP(req: any): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',');
    return ips[0].trim();
  }
  return req.headers['x-real-ip'] || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}
