// TIPOS E CONSTANTES COMPARTILHADAS - Configuração de Adquirentes

// Configuração de cada adquirente
export const ACQUIRER_CONFIG = {
  efibank: {
    name: 'EfíBank',
    icon: '',
    fields: [
      { key: 'productionClientId', label: 'Client ID (Produção)', type: 'text' as const, required: true },
      { key: 'productionClientSecret', label: 'Client Secret (Produção)', type: 'password' as const, required: true },
      { key: 'pixKey', label: 'Chave PIX', type: 'text' as const, required: false },
      { key: 'payeeCode', label: 'Payee Code', type: 'text' as const, required: false },
      { key: 'certificate', label: 'Certificado P12', type: 'file' as const, required: false },
    ]
  },
  stripe: {
    name: 'Stripe',
    icon: '',
    fields: [
      { key: 'secretKey', label: 'Secret Key', type: 'password', required: true },
      { key: 'publicKey', label: 'Public Key', type: 'text', required: true },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', required: false },
    ]
  },
  adyen: {
    name: 'Adyen',
    icon: '',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'merchantAccount', label: 'Merchant Account', type: 'text', required: true },
      { key: 'clientKey', label: 'Client Key', type: 'text', required: true },
    ]
  },
  woovi: {
    name: 'Woovi',
    icon: '',
    fields: [
      { key: 'appId', label: 'App ID', type: 'password', required: true },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', required: false },
    ]
  },
  pagarme: {
    name: 'Pagar.me',
    icon: '',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'encryptionKey', label: 'Encryption Key', type: 'password', required: false },
    ]
  },
  onz: {
    name: 'ONZ Finance',
    icon: '🏦',
    fields: [
      { key: 'cashInClientId',     label: 'Client ID Cash-in (BASSPAGO_77)',      type: 'text' as const,     required: true },
      { key: 'cashInClientSecret', label: 'Client Secret Cash-in',                type: 'password' as const, required: true },
      { key: 'cashOutClientId',    label: 'Client ID Cash-out (BASSPAGO_77)',     type: 'text' as const,     required: true },
      { key: 'cashOutClientSecret',label: 'Client Secret Cash-out',               type: 'password' as const, required: true },
      { key: 'pixKey',             label: 'Chave PIX de Recebimento',             type: 'text' as const,     required: true },
      { key: 'environment',        label: 'Ambiente (production / sandbox)',       type: 'text' as const,     required: false },
    ]
  }
} as const;

// Opções de adquirentes por método de pagamento
export const PAYMENT_METHOD_OPTIONS = {
  pix: [
    { value: 'onz',     label: 'ONZ Finance',  description: 'BaaS brasileiro - PIX direto (mTLS)' },
    { value: 'efibank', label: 'EfíBank',       description: 'Processador brasileiro' },
    { value: 'woovi',   label: 'Woovi',         description: 'OpenPix - PIX instantâneo' },
    { value: 'pagarme', label: 'Pagar.me',      description: 'Gateway brasileiro' }
  ],
  creditCardBR: [
    { value: 'efibank', label: 'EfíBank',       description: 'Cartões nacionais' },
    { value: 'stripe',  label: 'Stripe',        description: 'Gateway global' },
    { value: 'adyen',   label: 'Adyen',         description: 'Processador global' },
    { value: 'pagarme', label: 'Pagar.me',      description: 'Gateway brasileiro' }
  ],
  creditCardGlobal: [
    { value: 'stripe',  label: 'Stripe',        description: 'Recomendado para cartões globais' },
    { value: 'adyen',   label: 'Adyen',         description: 'Processador global' }
  ],
  boleto: [
    { value: 'onz',     label: 'ONZ Finance',  description: 'Boleto via BaaS ONZ' },
    { value: 'efibank', label: 'EfíBank',       description: 'Boleto bancário BR' },
    { value: 'woovi',   label: 'Woovi',         description: 'Boleto via Woovi' },
    { value: 'pagarme', label: 'Pagar.me',      description: 'Gateway brasileiro' }
  ]
} as const;

// Props compartilhadas para componentes de configuração
export interface AcquirerConfigProps {
  efibank: any;
  setEfibank: (value: any) => void;
  stripe: any;
  setStripe: (value: any) => void;
  adyen: any;
  setAdyen: (value: any) => void;
  woovi: any;
  setWoovi: (value: any) => void;
  pagarme: any;
  setPagarme: (value: any) => void;
  onz: any;
  setOnz: (value: any) => void;
  defaultAcquirers: any;
  setDefaultAcquirers: (value: any) => void;
  onSaveConfig?: () => Promise<void>;
}
