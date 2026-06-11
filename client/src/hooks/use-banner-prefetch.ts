import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface Banner {
  id: string;
  imageUrl: string;
  link?: string;
  targetBlank: boolean;
}

// PR-CARREGAR TODOS OS BANNERS IMPORTANTES AO INICIAR O APP
const PREFETCH_POSITIONS = ['login_page', 'register_page', 'dashboard_top', 'award_page', 'showcase'];

// Cache global de imagens pré-carregadas
const imageCache = new Map<string, HTMLImageElement>();

function preloadImage(url: string | undefined): Promise<void> {
  if (!url) return Promise.resolve();
  
  // Se já está em cache, retornar imediatamente
  if (imageCache.has(url)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(url, img);
      resolve();
    };
    img.onerror = () => {
      // Silently resolve - imagem não disponível não é erro crítico
      resolve();
    };
    img.src = url;
  });
}

async function fetchBannersForPosition(position: string): Promise<Banner[]> {
  try {
    const response = await fetch(`/api/banners/active?position=${position}`);
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) {
      await Promise.all(data.map(banner => preloadImage(banner.imageUrl)));
    }
    return data || [];
  } catch {
    return [];
  }
}

function useBannerPrefetch(position: string, enabled: boolean) {
  return useQuery<Banner[]>({
    queryKey: ['banners', 'active', position],
    queryFn: () => fetchBannersForPosition(position),
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 0,
    enabled,
  });
}

// Hook principal para pré-carregar TODOS os banners crticos
// Aguarda 3s após o mount para não bloquear o primeiro render
export function useBannersPrefetch() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const loginBanners = useBannerPrefetch('login_page', ready);
  const registerBanners = useBannerPrefetch('register_page', ready);
  const dashboardBanners = useBannerPrefetch('dashboard_top', ready);
  const awardBanners = useBannerPrefetch('award_page', ready);
  const showcaseBanners = useBannerPrefetch('showcase', ready);

  const isLoading = loginBanners.isLoading || 
                    registerBanners.isLoading || 
                    dashboardBanners.isLoading || 
                    awardBanners.isLoading ||
                    showcaseBanners.isLoading;

  const isReady = !isLoading;

  return {
    isLoading,
    isReady,
    banners: {
      login: loginBanners.data || [],
      register: registerBanners.data || [],
      dashboard: dashboardBanners.data || [],
      award: awardBanners.data || [],
      showcase: showcaseBanners.data || [],
    }
  };
}

export function useBanner(position: string) {
  const { data: banners = [] } = useQuery<Banner[]>({
    queryKey: ['banners', 'active', position],
    queryFn: () => fetchBannersForPosition(position),
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  const banner = banners && banners.length > 0 ? banners[0] : null;
  
  // Verificar se a imagem Jestem cache (pré-carregada)
  const isCached = banner?.imageUrl ? imageCache.has(banner.imageUrl) : false;

  return {
    banner,
    isCached, // Se true, a imagem Jfoi carregada e vai aparecerá instantaneamente
    banners,
  };
}
