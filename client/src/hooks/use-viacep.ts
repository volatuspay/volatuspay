import { useState, useCallback, useRef } from 'react';

export interface ViaCepResponse {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
}

export function useViaCep() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedCep = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchAddress = useCallback(async (cep: string): Promise<ViaCepResponse | null> => {
    const cleanCep = cep.replace(/\D/g, '');

    if (cleanCep.length !== 8) {
      setError('CEP inválido');
      return null;
    }

    if (lastFetchedCep.current === cleanCep) {
      return null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    lastFetchedCep.current = cleanCep;
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, {
        signal: abortControllerRef.current.signal,
      });
      
      if (!response.ok) {
        throw new Error('Erro ao buscar CEP');
      }

      const data: ViaCepResponse = await response.json();

      if (data.erro) {
        setError('CEP não encontrado');
        setLoading(false);
        return null;
      }

      setLoading(false);
      return data;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return null;
      }
      setError('Erro ao buscar CEP. Tente novamente.');
      setLoading(false);
      return null;
    }
  }, []);

  const resetLastCep = useCallback(() => {
    lastFetchedCep.current = null;
  }, []);

  return { fetchAddress, loading, error, resetLastCep };
}
