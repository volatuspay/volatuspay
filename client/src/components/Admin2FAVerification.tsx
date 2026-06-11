import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Shield, Mail, RefreshCw, Loader2 } from 'lucide-react';

interface Admin2FAVerificationProps {
  open: boolean;
  onVerified: () => void;
  onCancel: () => void;
  getAuthToken: () => Promise<string | null>;
}

export function Admin2FAVerification({ open, onVerified, onCancel, getAuthToken }: Admin2FAVerificationProps) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (open && !codeSent) {
      sendCode();
    }
  }, [open]);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const sendCode = async () => {
    setIsSending(true);
    setError('');
    try {
      const token = await getAuthToken();
      if (!token) {
        setError('Sessão expirada. Faça login novamente.');
        return;
      }

      const response = await fetch('/api/admin/2fa/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (response.ok) {
        setCodeSent(true);
        setResendCooldown(60);
        toast({
          title: 'Código enviado',
          description: 'Verifique seu email para o código de verificação.'
        });
      } else {
        setError(data.error || 'Erro ao enviar código');
      }
    } catch (err) {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setIsSending(false);
    }
  };

  const handleInputChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);
    setError('');

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newCode.every(digit => digit !== '') && newCode.join('').length === 6) {
      verifyCode(newCode.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData.length === 6) {
      const newCode = pastedData.split('');
      setCode(newCode);
      verifyCode(pastedData);
    }
  };

  const verifyCode = async (codeString: string) => {
    setIsLoading(true);
    setError('');
    try {
      const token = await getAuthToken();
      if (!token) {
        setError('Sessão expirada. Faça login novamente.');
        return;
      }

      const response = await fetch('/api/admin/2fa/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code: codeString })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast({
          title: 'Verificação concluída',
          description: 'Acesso administrativo liberado.'
        });
        onVerified();
      } else {
        setError(data.error || 'Código inválido');
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch (err) {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = () => {
    if (resendCooldown > 0) return;
    setCode(['', '', '', '', '', '']);
    sendCode();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent
        className="sm:max-w-md"
        style={{ background: "#0d0d0d", border: "1px solid rgba(155,48,255,0.25)", color: "#fff" }}
        data-testid="dialog-2fa-verification"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "#fff" }}>
            <Shield className="w-5 h-5" style={{ color: "#2563eb" }} />
            Verificação em Duas Etapas
          </DialogTitle>
          <DialogDescription style={{ color: "rgba(255,255,255,0.55)" }}>
            Para sua segurança, enviamos um código de 6 dígitos para seu email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {isSending && !codeSent ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#2563eb" }} />
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>Enviando código...</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
                <Mail className="w-4 h-4" />
                <span>Verifique sua caixa de entrada</span>
              </div>

              <div className="flex justify-center gap-2" onPaste={handlePaste}>
                {code.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { inputRefs.current[index] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleInputChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    disabled={isLoading}
                    data-testid={`input-2fa-digit-${index}`}
                    style={{
                      width: "3rem", height: "3.5rem",
                      textAlign: "center", fontSize: "1.5rem", fontWeight: "bold",
                      background: "rgba(255,255,255,0.06)",
                      border: "2px solid rgba(155,48,255,0.35)",
                      borderRadius: "0.5rem", color: "#fff", outline: "none"
                    }}
                    onFocus={(e) => { e.target.style.borderColor = "#2563eb"; e.target.style.boxShadow = "0 0 0 2px rgba(155,48,255,0.25)"; }}
                    onBlur={(e) => { e.target.style.borderColor = "rgba(155,48,255,0.35)"; e.target.style.boxShadow = "none"; }}
                  />
                ))}
              </div>

              {error && (
                <p className="text-sm text-center" style={{ color: "#f87171" }} data-testid="text-2fa-error">
                  {error}
                </p>
              )}

              {isLoading && (
                <div className="flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#2563eb" }} />
                </div>
              )}

              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={handleResend}
                  disabled={resendCooldown > 0 || isSending}
                  data-testid="button-resend-2fa"
                  style={{
                    display: "flex", alignItems: "center", gap: "0.4rem",
                    fontSize: "0.875rem", background: "transparent", border: "none",
                    color: resendCooldown > 0 ? "rgba(255,255,255,0.35)" : "#2563eb",
                    cursor: resendCooldown > 0 ? "not-allowed" : "pointer"
                  }}
                >
                  <RefreshCw className="w-4 h-4" />
                  {resendCooldown > 0
                    ? `Reenviar em ${resendCooldown}s`
                    : 'Reenviar código'}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            data-testid="button-cancel-2fa"
            style={{
              padding: "0.5rem 1rem", borderRadius: "0.375rem", fontSize: "0.875rem",
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.7)", cursor: "pointer"
            }}
          >
            Cancelar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default Admin2FAVerification;
