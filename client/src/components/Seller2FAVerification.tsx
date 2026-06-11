/**
 * 🔐 SELLER 2FA VERIFICATION COMPONENT
 * Modal de verificação de dois fatores para vendedores
 * ✅ OTIMIZADO PARA ANDROID/MOBILE
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Shield, Mail, RefreshCw, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';

interface Seller2FAVerificationProps {
  isOpen: boolean;
  onVerified: () => void;
  onClose?: () => void;
}

export function Seller2FAVerification({ isOpen, onVerified, onClose }: Seller2FAVerificationProps) {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const [sendAttempts, setSendAttempts] = useState(0);
  const [emailError, setEmailError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasSentRef = useRef(false);
  const { toast } = useToast();

  // Helper para obter headers de autenticação
  const getAuthHeaders = async () => {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado');
    const token = await user.getIdToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  // 📱 ANDROID FIX: Função de envio com timeout e proteção contra duplicação
  const sendCode = useCallback(async () => {
    if (isSending || hasSentRef.current) return;
    
    setIsSending(true);
    setError('');
    setEmailError(false);
    hasSentRef.current = true;

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Usuário não autenticado');
      const token = await user.getIdToken();
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };
      
      // 📱 ANDROID FIX: Timeout para evitar request travado em redes lentas
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch('/api/seller/2fa/send', {
        method: 'POST',
        headers,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      const data = await response.json();

      if (response.ok && data.success) {
        setCodeSent(true);
        setCountdown(60);
        setSendAttempts(prev => prev + 1);
        toast({
          title: 'Código enviado',
          description: 'Verifique seu email para obter o código de verificação.',
        });
      } else {
        setEmailError(true);
        setError(data.error || 'Erro ao enviar código. Tente novamente.');
        hasSentRef.current = false;
      }
    } catch (err: any) {
      setEmailError(true);
      if (err.name === 'AbortError') {
        setError('Tempo esgotado. Verifique sua conexão e tente novamente.');
      } else {
        setError(err.message || 'Erro ao enviar código. Verifique sua conexão.');
      }
      hasSentRef.current = false;
    } finally {
      setIsSending(false);
    }
  }, [isSending, toast]);

  // 📱 ANDROID FIX: Enviar código apenas uma vez quando modal abre
  useEffect(() => {
    if (isOpen && !codeSent && !hasSentRef.current && !isSending) {
      sendCode();
    }
    
    // Reset quando modal fecha
    if (!isOpen) {
      hasSentRef.current = false;
      setCodeSent(false);
      setCode('');
      setError('');
      setEmailError(false);
    }
  }, [isOpen, codeSent, isSending, sendCode]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // 📱 ANDROID FIX: Delay no foco para evitar problemas de teclado virtual
  useEffect(() => {
    if (isOpen && codeSent && inputRef.current) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, codeSent]);

  const verifyCode = async () => {
    if (code.length !== 6) {
      setError('Digite o código de 6 dígitos');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/seller/2fa/verify', {
        method: 'POST',
        headers,
        body: JSON.stringify({ code })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast({
          title: 'Verificação concluída',
          description: 'Acesso liberado com sucesso!',
        });
        onVerified();
      } else {
        setError(data.error || 'Código inválido');
        setCode('');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao verificar código');
    } finally {
      setIsLoading(false);
    }
  };

  const resendCode = async () => {
    if (countdown > 0) return;

    setIsSending(true);
    setError('');
    setCode('');

    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/seller/2fa/resend', {
        method: 'POST',
        headers
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setCountdown(60);
        toast({
          title: 'Novo código enviado',
          description: 'Verifique seu email.',
        });
      } else {
        setError(data.error || 'Erro ao reenviar código');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao reenviar código');
    } finally {
      setIsSending(false);
    }
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
    setError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && code.length === 6) {
      verifyCode();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <DialogTitle>Verificação de Segurança</DialogTitle>
              <DialogDescription>
                Proteção de dois fatores obrigatória
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!codeSent ? (
            <div className="text-center space-y-4">
              {emailError ? (
                <>
                  <div className="p-4 rounded-full bg-destructive/10 inline-block">
                    <XCircle className="w-8 h-8 text-destructive" />
                  </div>
                  <p className="text-sm text-destructive font-medium">
                    {error || 'Erro ao enviar código'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Verifique sua conexão com a internet e tente novamente.
                  </p>
                  <Button
                    onClick={() => {
                      setEmailError(false);
                      setError('');
                      hasSentRef.current = false;
                      sendCode();
                    }}
                    disabled={isSending}
                    className="mt-2"
                    data-testid="button-retry-send-2fa"
                  >
                    {isSending ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      'Tentar Novamente'
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <div className="p-4 rounded-full bg-muted inline-block">
                    <Mail className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Enviando código de verificação para seu email...
                  </p>
                  {isSending && (
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-primary" />
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="text-center space-y-2">
                <div className="p-3 rounded-full bg-blue-100 dark:bg-green-900/20 inline-block">
                  <CheckCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Um código de 6 dígitos foi enviado para seu email cadastrado.
                </p>
              </div>

              <div className="space-y-3">
                <Input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  value={code}
                  onChange={handleCodeChange}
                  onKeyDown={handleKeyDown}
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                  maxLength={6}
                  disabled={isLoading}
                  data-testid="input-2fa-code"
                />

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  onClick={verifyCode}
                  disabled={code.length !== 6 || isLoading}
                  className="w-full"
                  data-testid="button-verify-2fa"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Verificando...
                    </>
                  ) : (
                    'Verificar Código'
                  )}
                </Button>

                <div className="text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resendCode}
                    disabled={countdown > 0 || isSending}
                    className="text-muted-foreground"
                    data-testid="button-resend-2fa"
                  >
                    {countdown > 0 ? (
                      `Reenviar em ${countdown}s`
                    ) : isSending ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      'Reenviar código'
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
