import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Shield, Loader2, Mail, RefreshCw } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useAdmin2FAStore } from '@/stores/admin-2fa';

interface Admin2FAVerifyProps {
  onVerified: () => void;
  mode?: 'login' | 'acquirers';
}

export function Admin2FAVerify({ onVerified, mode = 'login' }: Admin2FAVerifyProps) {
  const { toast } = useToast();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { setVerified, setAcquirersVerified } = useAdmin2FAStore();

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  const sendCode = async (isResend = false) => {
    setIsSending(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        toast({ title: 'Erro', description: 'Usuário não autenticado', variant: 'destructive' });
        return;
      }

      const token = await user.getIdToken();
      const endpoint = isResend ? '/api/admin/2fa/resend' : '/api/admin/2fa/send';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (data.success) {
        setCodeSent(true);
        setResendTimer(60);
        if (data.emailFailed) {
          toast({ 
            title: 'Código gerado', 
            description: 'Email falhou — copie o código do console do servidor (logs do workflow)',
            variant: 'default'
          });
        } else {
          toast({ title: 'Código enviado', description: 'Verifique seu email' });
        }
        inputRefs.current[0]?.focus();
      } else {
        toast({ title: 'Erro', description: data.error || 'Falha ao enviar código', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Erro', description: 'Erro ao enviar código', variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  const submitCode = async (fullCode: string) => {
    if (fullCode.length !== 6) {
      toast({ title: 'Erro', description: 'Digite os 6 dígitos', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        toast({ title: 'Erro', description: 'Usuário não autenticado', variant: 'destructive' });
        return;
      }

      const token = await user.getIdToken();
      const response = await fetch('/api/admin/2fa/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code: fullCode })
      });

      const data = await response.json();

      if (data.success) {
        toast({ title: 'Verificado', description: 'Acesso liberado' });
        if (mode === 'acquirers') {
          setAcquirersVerified(true);
        } else {
          setVerified(true);
        }
        onVerified();
      } else {
        toast({ title: 'Código inválido', description: data.error || 'Tente novamente', variant: 'destructive' });
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch (error) {
      toast({ title: 'Erro', description: 'Erro ao verificar código', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const verifyCode = () => submitCode(code.join(''));

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    
    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newCode.every(d => d !== '') && newCode.join('').length === 6) {
      setTimeout(() => submitCode(newCode.join('')), 100);
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      verifyCode();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData.length === 6) {
      const newCode = pastedData.split('');
      setCode(newCode);
      inputRefs.current[5]?.focus();
      setTimeout(() => submitCode(pastedData), 100);
    }
  };

  const title = mode === 'acquirers' 
    ? 'Verificação de Segurança - Adquirentes' 
    : 'Verificação em Duas Etapas';
  
  const description = mode === 'acquirers'
    ? 'Área ultra-protegida. Verifique sua identidade para acessar as configurações de pagamento.'
    : 'Digite o código de 6 dígitos enviado para seu email para acessar o painel administrativo.';

  if (!codeSent) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
        <Card className="w-full max-w-md bg-zinc-900/90 border-zinc-800 backdrop-blur-xl">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-[#B3E246]/10 flex items-center justify-center">
              <Shield className="w-8 h-8 text-[#B3E246]" />
            </div>
            <CardTitle className="text-xl text-white" data-testid="text-2fa-title">{title}</CardTitle>
            <CardDescription className="text-zinc-400">{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center">
              <Mail className="w-12 h-12 mx-auto text-zinc-500 mb-4" />
              <p className="text-sm text-zinc-400 mb-6">
                Clique abaixo para receber um código de verificação no seu email cadastrado.
              </p>
            </div>
            <Button
              onClick={sendCode}
              disabled={isSending}
              className="w-full bg-[#B3E246] hover:bg-[#9FCC3C] text-black font-semibold py-6"
              data-testid="button-send-2fa-code"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  Enviar Código por Email
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md bg-zinc-900/90 border-zinc-800 backdrop-blur-xl">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-[#B3E246]/10 flex items-center justify-center">
            <Shield className="w-8 h-8 text-[#B3E246]" />
          </div>
          <CardTitle className="text-xl text-white">{title}</CardTitle>
          <CardDescription className="text-zinc-400">
            Digite o código de 6 dígitos enviado para seu email
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex justify-center gap-3">
            {code.map((digit, index) => (
              <input
                key={index}
                ref={(el) => { inputRefs.current[index] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={index === 0 ? handlePaste : undefined}
                className="w-12 h-16 text-center text-2xl font-bold bg-zinc-800/50 border-2 border-zinc-700 rounded-lg text-white focus:border-[#B3E246] focus:ring-2 focus:ring-[#B3E246]/50 outline-none transition-all"
                data-testid={`input-2fa-digit-${index}`}
              />
            ))}
          </div>

          <Button
            onClick={verifyCode}
            disabled={isLoading || code.some(d => d === '')}
            className="w-full bg-[#B3E246] hover:bg-[#9FCC3C] text-black font-semibold py-6"
            data-testid="button-verify-2fa-code"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Verificando...
              </>
            ) : (
              'Verificar Código'
            )}
          </Button>

          <div className="text-center">
            {resendTimer > 0 ? (
              <p className="text-sm text-zinc-500">
                Reenviar código em {resendTimer}s
              </p>
            ) : (
              <button
                onClick={() => sendCode(true)}
                disabled={isSending}
                className="text-sm text-[#B3E246] hover:underline flex items-center justify-center gap-1 mx-auto"
                data-testid="button-resend-2fa-code"
              >
                <RefreshCw className="w-3 h-3" />
                Reenviar código
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
