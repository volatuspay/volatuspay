import { useState, useEffect } from 'react';

export function useImagePreloader(imageUrl: string | null | undefined) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!imageUrl) {
      setIsLoaded(true);
      return;
    }

    const img = new Image();
    
    img.onload = () => {
      setIsLoaded(true);
    };

    img.onerror = () => {
      setIsLoaded(true);
    };

    img.src = imageUrl;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [imageUrl]);

  return isLoaded;
}
