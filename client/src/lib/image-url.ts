const BUNNY_CDN_HOSTNAMES = [
  'volatuspay.b-cdn.net',
  'volatuspaypj.b-cdn.net',
  'vz-67b426f1-9fa.b-cdn.net',
  'volatuspay-old.b-cdn.net',
];

export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  if (url.startsWith('/api/images/')) return url;

  // CDN URLs are already fully public — serve them directly without the server proxy.
  // The proxy just adds a round-trip and fails in production when storage credentials are missing.
  for (const host of BUNNY_CDN_HOSTNAMES) {
    if (url.includes(host)) {
      return url; // serve directly from Bunny CDN pull zone
    }
  }

  // Other fully-qualified URLs (https://...) — pass through as-is
  if (url.startsWith('https://') || url.startsWith('http://')) {
    return url;
  }

  // Local /uploads/ paths — proxy through server so it can fallback to CDN
  if (url.startsWith('/uploads/')) {
    const filePath = url.replace('/uploads/', '');
    return `/api/images/${filePath}`;
  }

  return url;
}
