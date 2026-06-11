import { useState, useEffect } from 'react';

interface ExchangeRates {
  USD: number;
  EUR: number;
  GBP: number;
  CAD: number;
  AUD: number;
  BRL: number;
}

interface CurrencyRatesData {
  success: boolean;
  rates: ExchangeRates;
}

export const useCurrencyRates = () => {
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRates = async () => {
    try {
      const response = await fetch('/api/exchange-rates');
      const data: CurrencyRatesData = await response.json();
      
      if (data.success) {
        setRates(data.rates);
        setError(null);
      } else {
        setError('Erro ao buscar taxas de cmbio');
      }
    } catch (err) {
      console.error('Erro ao buscar taxas:', err);
      setError('Falha na conexo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRates();
    // Atualizar taxas a cada 5 minutos
    const interval = setInterval(fetchRates, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const convertCurrency = (amount: number, fromCurrency: string, toCurrency: string = 'BRL'): number => {
    if (!rates || fromCurrency === toCurrency) return amount;
    
    if (fromCurrency === 'BRL' && toCurrency !== 'BRL') {
      return amount / rates[toCurrency as keyof ExchangeRates];
    }
    
    if (fromCurrency !== 'BRL' && toCurrency === 'BRL') {
      return amount * rates[fromCurrency as keyof ExchangeRates];
    }
    
    // Conversão entre moedas no-BRL via BRL
    const amountInBRL = amount * rates[fromCurrency as keyof ExchangeRates];
    return amountInBRL / rates[toCurrency as keyof ExchangeRates];
  };

  const formatCurrencyWithConversion = (amount: number, fromCurrency: string, showConversion: boolean = true): string => {
    const originalFormatted = new Intl.NumberFormat(getLocaleForCurrency(fromCurrency), {
      style: 'currency',
      currency: fromCurrency
    }).format(amount / 100);

    if (!showConversion || fromCurrency === 'BRL' || !rates) {
      return originalFormatted;
    }

    const convertedAmount = convertCurrency(amount, fromCurrency, 'BRL');
    const convertedFormatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(convertedAmount / 100);

    return `${originalFormatted} (${convertedFormatted})`;
  };

  return {
    rates,
    loading,
    error,
    convertCurrency,
    formatCurrencyWithConversion,
    refreshRates: fetchRates
  };
};

const getLocaleForCurrency = (currency: string): string => {
  const locales: Record<string, string> = {
    'USD': 'en-US',
    'EUR': 'de-DE', 
    'GBP': 'en-GB',
    'CAD': 'en-CA',
    'AUD': 'en-AU',
    'BRL': 'pt-BR'
  };
  return locales[currency] || 'en-US';
};