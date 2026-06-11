import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export interface GlobalConfiguration {
  // Dados da empresa
  gatewayName: string;
  companyRegistration: string; // CNPJ
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  
  // SEO
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  
  // Cores
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  
  // Logos (compatibilidade - legacy)
  headerLogoUrl?: string;
  siteLogoUrl?: string;
  
  // Logos por tema - novas propriedades
  headerLogoLight?: string;   // Logo clara para tema claro
  headerLogoDark?: string;    // Logo escura para tema escuro
  siteLogoLight?: string;     // Logo clara para tema claro
  siteLogoDark?: string;      // Logo escura para tema escuro
}

const DEFAULT_CONFIG: GlobalConfiguration = {
  // Dados padrão
  gatewayName: "VolatusPay",
  companyRegistration: "",
  companyAddress: "",
  companyPhone: "",
  companyEmail: "volatuspay@gmail.com",
  
  // SEO padrão
  siteTitle: "VolatusPay",
  siteSubtitle: "Gateway de Pagamentos",
  siteDescription: "VolatusPay — O gateway de pagamentos para criadores digitais",
  
  // Cores padrão (VolatusPay)
  primaryColor: "#72FC2D",
  secondaryColor: "#72FC2D",
  backgroundColor: "#ffffff",
  textColor: "#1f2937",
  
  // Logos vazias inicialmente (legacy)
  headerLogoUrl: undefined,
  siteLogoUrl: undefined,
  
  // Logos por tema
  headerLogoLight: "/logos/volatuspay-logo.png",
  headerLogoDark: "/logos/volatuspay-logo.png",
  siteLogoLight: "/logos/volatuspay-logo.png",
  siteLogoDark: "/logos/volatuspay-logo.png",
};

interface GlobalConfigState {
  config: GlobalConfiguration;
  loading: boolean;
  error: string | null;
  
  // Actions
  updateConfig: (updates: Partial<GlobalConfiguration>) => void;
  resetConfig: () => void;
  startSync: () => void;
  stopSync: () => void;
}


export const useGlobalConfigStore = create<GlobalConfigState>()(
  subscribeWithSelector((set, get) => ({
    config: DEFAULT_CONFIG,
    loading: false,
    error: null,

    updateConfig: (updates: Partial<GlobalConfiguration>) => {
      set((state) => ({
        config: { ...state.config, ...updates }
      }));
    },

    resetConfig: () => {
      set({ config: DEFAULT_CONFIG });
    },

    startSync: () => {
      // Usar apenas configuração padrão local - sem acesso Firebase direto
      set({ 
        config: DEFAULT_CONFIG, 
        loading: false,
        error: null 
      });
      console.log("Usando configuração padrão - sem listener Firebase");
    },

    stopSync: () => {
      console.log("No hsincronizao para parar - usando configuração local");
    },
  }))
);

// Auto-inicializar a configuração padrão quando a store é criada
if (typeof window !== "undefined") {
  console.log("Inicializando useGlobalConfigStore no browser com configuração padrão...");
  useGlobalConfigStore.getState().startSync();
}