/**
 * 💱 CONVERSOR DE MOEDA EM TEMPO REAL
 * Converte USD/EUR/outras moedas para BRL automaticamente
 */

interface ExchangeRates {
  [key: string]: number;
}

interface ConversionResult {
  originalAmount: number;
  originalCurrency: string;
  convertedAmount: number;
  convertedCurrency: string;
  exchangeRate: number;
  timestamp: Date;
}

class CurrencyConverter {
  private static instance: CurrencyConverter;
  private rates: ExchangeRates = {};
  private lastUpdate: Date | null = null;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

  public static getInstance(): CurrencyConverter {
    if (!CurrencyConverter.instance) {
      CurrencyConverter.instance = new CurrencyConverter();
    }
    return CurrencyConverter.instance;
  }

  private constructor() {
    // Inicializar com taxas dinâmicas - SEMPRE buscar valores reais
    this.rates = {
      'BRL': 1.00  // Base sempre BRL
    };
    
    // 🔄 BUSCAR TAXAS REAIS IMEDIATAMENTE na inicialização
    this.updateRates().catch(error => {
      console.warn('⚠️ Falha ao buscar taxas iniciais, usando dados mínimos:', error);
      // Só em caso de falha total, usar valores base conservadores
      this.rates = {
        'USD': 5.20, // Atualizado para valor mais realista
        'EUR': 5.50, 
        'GBP': 6.30, 
        'CAD': 3.80, 
        'AUD': 3.30, 
        'BRL': 1.00
      };
    });
  }

  /**
   * 🔄 ATUALIZAR TAXAS EM TEMPO REAL
   */
  private async updateRates(): Promise<void> {
    try {
      // Múltiplas fontes de câmbio para garantir disponibilidade
      const sources = [
        () => this.fetchFromAwesomeAPI(),
        () => this.fetchFromExchangeAPI(),
        () => this.fetchFromBCB()
      ];

      for (const source of sources) {
        try {
          const newRates = await source();
          if (newRates && Object.keys(newRates).length > 0) {
            this.rates = { ...this.rates, ...newRates };
            this.lastUpdate = new Date();
            console.log('💱 Taxas de câmbio atualizadas:', newRates);
            return;
          }
        } catch (error) {
          console.log('⚠️ Fonte de câmbio falhou, tentando próxima...');
          continue;
        }
      }
    } catch (error) {
      console.log('⚠️ Erro ao atualizar taxas, usando cache:', error);
    }
  }

  /**
   * 🇧🇷 API AWESOME (BRASIL) - PRINCIPAL
   */
  private async fetchFromAwesomeAPI(): Promise<ExchangeRates> {
    const response = await fetch('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL,GBP-BRL,CAD-BRL,AUD-BRL');
    const data = await response.json() as any;
    
    return {
      'USD': parseFloat(data.USDBRL?.bid || data.USDBRL?.ask || '5.20'),
      'EUR': parseFloat(data.EURBRL?.bid || data.EURBRL?.ask || '5.50'),
      'GBP': parseFloat(data.GBPBRL?.bid || data.GBPBRL?.ask || '6.30'),
      'CAD': parseFloat(data.CADBRL?.bid || data.CADBRL?.ask || '3.80'),
      'AUD': parseFloat(data.AUDBRL?.bid || data.AUDBRL?.ask || '3.30'),
      'BRL': 1.00
    };
  }

  /**
   * 🌍 EXCHANGE API (GLOBAL) - BACKUP 1
   */
  private async fetchFromExchangeAPI(): Promise<ExchangeRates> {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/BRL');
    const data = await response.json() as any;
    
    return {
      'USD': 1 / (data.rates?.USD || 0.19),
      'EUR': 1 / (data.rates?.EUR || 0.18),
      'GBP': 1 / (data.rates?.GBP || 0.16),
      'CAD': 1 / (data.rates?.CAD || 0.26),
      'AUD': 1 / (data.rates?.AUD || 0.30),
      'BRL': 1.00
    };
  }

  /**
   * 🏦 BANCO CENTRAL (OFICIAL) - BACKUP 2
   */
  private async fetchFromBCB(): Promise<ExchangeRates> {
    const response = await fetch('https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaAtual(moeda=@moeda)?@moeda=%27USD%27&$format=json');
    const data = await response.json() as any;
    
    const usdRate = data.value?.[0]?.cotacaoVenda || 5.45;
    
    return {
      'USD': parseFloat(usdRate),
      'EUR': parseFloat(usdRate) * 1.10, // Aproximação EUR baseada em USD
      'GBP': parseFloat(usdRate) * 1.25, // Aproximação GBP baseada em USD
      'CAD': parseFloat(usdRate) * 0.75, // Aproximação CAD baseada em USD
      'AUD': parseFloat(usdRate) * 0.65, // Aproximação AUD baseada em USD
      'BRL': 1.00
    };
  }

  /**
   * 💰 CONVERTER MOEDA PARA BRL
   */
  public async convertToBRL(amount: number, fromCurrency: string): Promise<ConversionResult> {
    // Se já é BRL, retorna direto
    if (fromCurrency === 'BRL') {
      return {
        originalAmount: amount,
        originalCurrency: fromCurrency,
        convertedAmount: amount,
        convertedCurrency: 'BRL',
        exchangeRate: 1.0,
        timestamp: new Date()
      };
    }

    // Atualizar taxas se necessário
    const now = new Date();
    if (!this.lastUpdate || (now.getTime() - this.lastUpdate.getTime()) > this.CACHE_DURATION) {
      await this.updateRates();
    }

    const rate = this.rates[fromCurrency] || this.rates['USD'] || 5.45;
    const convertedAmount = Math.round(amount * rate);

    console.log(`💱 CONVERSÃO: ${amount} ${fromCurrency} → ${convertedAmount/100} BRL (taxa: ${rate})`);

    return {
      originalAmount: amount,
      originalCurrency: fromCurrency,
      convertedAmount: convertedAmount,
      convertedCurrency: 'BRL',
      exchangeRate: rate,
      timestamp: now
    };
  }

  /**
   * 📊 OBTER TAXA ATUAL
   */
  public async getExchangeRate(fromCurrency: string): Promise<number> {
    if (fromCurrency === 'BRL') return 1.0;
    
    const now = new Date();
    if (!this.lastUpdate || (now.getTime() - this.lastUpdate.getTime()) > this.CACHE_DURATION) {
      await this.updateRates();
    }
    
    return this.rates[fromCurrency] || this.rates['USD'] || 5.45;
  }

  /**
   * 🌍 FORMATAR VALOR NA MOEDA ORIGINAL + BRL
   */
  public formatConversion(result: ConversionResult): string {
    const original = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: result.originalCurrency
    }).format(result.originalAmount / 100);

    const converted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(result.convertedAmount / 100);

    return `${original} (${converted})`;
  }
}

export const currencyConverter = CurrencyConverter.getInstance();
export type { ConversionResult };