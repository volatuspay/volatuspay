import { useEffect } from "react";
import { useGlobalConfigStore } from "@/stores/global-config";

/**
 * Hook para aplicar configurações de SEO dinamicamente
 * Atualiza title, meta description e outros elementos SEO
 */
export function useSEOConfig() {
  const { config } = useGlobalConfigStore();

  useEffect(() => {
    //  TÍTULO FIXO "VolatusPay" - NÃO ALTERAR DINAMICAMENTE
    // document.title permanece fixo do index.html

    // ATUALIZAR META DESCRIPTION
    let metaDescription = document.querySelector('meta[name="description"]');
    if (!metaDescription) {
      metaDescription = document.createElement('meta');
      metaDescription.setAttribute('name', 'description');
      document.head.appendChild(metaDescription);
    }
    if (config.siteDescription) {
      metaDescription.setAttribute('content', config.siteDescription);
    }

    // ATUALIZAR OPEN GRAPH TAGS
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (!ogTitle) {
      ogTitle = document.createElement('meta');
      ogTitle.setAttribute('property', 'og:title');
      document.head.appendChild(ogTitle);
    }
    if (config.siteTitle) {
      ogTitle.setAttribute('content', config.siteTitle);
    }

    let ogDescription = document.querySelector('meta[property="og:description"]');
    if (!ogDescription) {
      ogDescription = document.createElement('meta');
      ogDescription.setAttribute('property', 'og:description');
      document.head.appendChild(ogDescription);
    }
    if (config.siteDescription) {
      ogDescription.setAttribute('content', config.siteDescription);
    }

    // ATUALIZAR THEME COLOR
    let themeColor = document.querySelector('meta[name="theme-color"]');
    if (!themeColor) {
      themeColor = document.createElement('meta');
      themeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(themeColor);
    }
    if (config.primaryColor) {
      themeColor.setAttribute('content', config.primaryColor);
    }

    console.log('SEO aplicado:', {
      title: config.siteTitle,
      description: config.siteDescription,
      themeColor: config.primaryColor
    });

  }, [config.siteTitle, config.siteDescription, config.primaryColor]);

  return {
    siteTitle: config.siteTitle,
    siteSubtitle: config.siteSubtitle,
    siteDescription: config.siteDescription,
  };
}