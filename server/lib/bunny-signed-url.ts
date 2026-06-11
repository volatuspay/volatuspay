import crypto from 'crypto';

const DEFAULT_TTL = 3600; // 1 hora

export interface SignedVideoResult {
  iframeUrl: string;
  expires: number;
}

/**
 * Gera URL assinada (token auth) para vídeos do Bunny Stream.
 * O token impede que a URL seja compartilhada fora da plataforma —
 * ela expira automaticamente após `ttlSeconds`.
 *
 * Algoritmo: SHA256(authKey + videoGuid + expires)
 * Ref: https://docs.bunny.net/docs/stream-token-authentication
 */
export function signBunnyVideoUrl(
  libraryId: string | number,
  videoGuid: string,
  authKey: string,
  ttlSeconds = DEFAULT_TTL
): SignedVideoResult {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const hashable = authKey + videoGuid + expires;
  const token = crypto.createHash('sha256').update(hashable).digest('hex');
  const iframeUrl =
    `https://iframe.mediadelivery.net/embed/${libraryId}/${videoGuid}` +
    `?token=${token}&expires=${expires}`;
  return { iframeUrl, expires };
}

const GUID_RE = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;

/**
 * Dado um array de lições, adiciona `signedVideoUrl` e `videoUrlExpires`
 * para lições com videoType === 'panda'.
 * Se não houver authKey configurado, retorna as lições sem modificação.
 */
export async function signLessonVideos(lessons: any[]): Promise<any[]> {
  try {
    const { getBunnyCredentials } = await import('./bunny-helper.js');
    const credentials = await getBunnyCredentials() as any;
    const authKey: string | undefined = credentials?.streamTokenKey;
    const libraryId = credentials?.streamLibraryId;

    if (!authKey || !libraryId) {
      return lessons; // token auth não configurado — retorna sem assinar
    }

    const expires = Math.floor(Date.now() / 1000) + DEFAULT_TTL;

    return lessons.map(lesson => {
      if (lesson.videoType === 'panda' && lesson.videoUrl) {
        const m = lesson.videoUrl.match(GUID_RE);
        if (m) {
          const { iframeUrl } = signBunnyVideoUrl(libraryId, m[1], authKey, DEFAULT_TTL);
          return { ...lesson, signedVideoUrl: iframeUrl, videoUrlExpires: expires };
        }
      }
      return lesson;
    });
  } catch {
    return lessons; // nunca quebra o fluxo
  }
}

/**
 * Retorna uma URL assinada avulsa para um videoGuid específico.
 * Útil para endpoints de renovação de token.
 */
export async function getSignedVideoUrl(videoGuid: string, ttlSeconds = DEFAULT_TTL): Promise<string | null> {
  try {
    const { getBunnyCredentials } = await import('./bunny-helper.js');
    const credentials = await getBunnyCredentials() as any;
    const authKey: string | undefined = credentials?.streamTokenKey;
    const libraryId = credentials?.streamLibraryId;
    if (!authKey || !libraryId) return null;
    const { iframeUrl } = signBunnyVideoUrl(libraryId, videoGuid, authKey, ttlSeconds);
    return iframeUrl;
  } catch {
    return null;
  }
}
