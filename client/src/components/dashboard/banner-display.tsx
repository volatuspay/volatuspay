import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resolveImageUrl } from '@/lib/image-url';

interface Banner {
  id: string;
  title: string;
  imageUrl: string;
  link?: string;
  targetBlank: boolean;
  description?: string;
}

interface BannerDisplayProps {
  position?: string;
}

export default function BannerDisplay({ position = 'dashboard_top' }: BannerDisplayProps) {
  const { data: banners = [], isLoading, isError, error } = useQuery<Banner[]>({
    queryKey: ['banners', 'active', position],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/banners/active?position=${position}`);
        
        if (!response.ok) {
          return [];
        }
        
        const data = await response.json();
        return data || [];
      } catch (err) {
        return [];
      }
    },
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: 5 * 60 * 1000,
    retry: 0,
  });

  //  SISTEMA ETERNO: SEMPRE MOSTRA BANNERS
  // Durante loading, mostrar skeleton
  if (isLoading) {
    return (
      <div className="mt-2 mb-4 w-full" data-testid="banner-loading">
        <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg w-full" style={{ aspectRatio: '1600/150', maxWidth: '1600px', margin: '0 auto' }}></div>
      </div>
    );
  }

  //  ERRO OU SEM BANNERS: No exibir nada (sistema eterno jativo no backend)
  if (!banners || banners.length === 0) {
    return null;
  }

  const handleBannerClick = (banner: Banner) => {
    if (banner.link) {
      if (banner.targetBlank) {
        window.open(banner.link, '_blank', 'noopener,noreferrer');
      } else {
        window.location.href = banner.link;
      }
    }
  };

  return (
    <div className="mt-2 mb-4 w-full" data-testid="banner-display">
      {banners.slice(0, 1).map((banner) => (
        <div 
          key={banner.id}
          className={`
            relative rounded-lg shadow-lg w-full overflow-hidden
            ${banner.link ? 'cursor-pointer hover:opacity-90 transition-opacity duration-200' : ''}
          `}
          onClick={() => handleBannerClick(banner)}
          data-testid={`banner-${banner.id}`}
          style={{ maxWidth: '1600px', margin: '0 auto' }}
        >
          <img
            src={resolveImageUrl(banner.imageUrl) || ''}
            alt={banner.description || banner.title}
            className="w-full h-auto object-contain"
            style={{ aspectRatio: '1600/150', display: 'block' }}
            loading="lazy"
            onError={(e) => {
              console.error('❌ Erro ao carregar banner:', banner.imageUrl);
              const img = e.target as HTMLImageElement;
              const bannerElement = img.closest('[data-testid^="banner-"]') as HTMLElement;
              if (bannerElement) {
                bannerElement.remove();
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}