import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function ImpersonatePage() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Autenticando...');

  useEffect(() => {
    const authenticateWithToken = async () => {
      try {
        // Pegar o token da URL
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');

        if (!token) {
          setStatus('error');
          setMessage('Token de autenticação não encontrado na URL');
          return;
        }

        console.log('Impersonation: Token recebido, fazendo login...');

        // Fazer login com o custom token
        const userCredential = await signInWithCustomToken(auth, token);
        
        console.log('Login via impersonation bem-sucedido:', {
          uid: userCredential.user.uid,
          email: userCredential.user.email
        });

        setStatus('success');
        setMessage('Login realizado com sucesso! Redirecionando...');

        // Aguardar um pouco para mostrar a mensagem de sucesso
        setTimeout(() => {
          // Redirecionar para o dashboard
          setLocation('/dashboard');
        }, 1000);

      } catch (error: any) {
        console.error('Erro no impersonation:', error);
        setStatus('error');
        setMessage(`Erro ao fazer login: ${error.message || 'Erro desconhecido'}`);
      }
    };

    authenticateWithToken();
  }, [setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-blue-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            {status === 'loading' && (
              <>
                <div className="w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Autenticando...</h1>
                <p className="text-gray-600">{message}</p>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-violet-600 mb-2">Login Realizado!</h1>
                <p className="text-gray-600">{message}</p>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-red-600 mb-2">Erro na Autenticação</h1>
                <p className="text-gray-600 mb-4">{message}</p>
                <button
                  onClick={() => setLocation('/auth/login')}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  Voltar ao Login
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
