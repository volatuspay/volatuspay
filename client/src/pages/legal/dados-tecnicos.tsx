import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Lock, Eye, UserCheck, FileText, Shield } from "lucide-react";
import { SiteFooter } from "@/components/layout/site-footer";

function RealisticShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shieldBody" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="50%" stopColor="#059669" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
        <linearGradient id="shieldHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id="shieldBorder" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6ee7b7" />
          <stop offset="100%" stopColor="#065f46" />
        </linearGradient>
      </defs>
      <path d="M32 4 L56 14 C56 14 58 38 32 58 C6 38 8 14 8 14 Z" fill="url(#shieldBorder)" />
      <path d="M32 7 L53 16 C53 16 55 37 32 55 C9 37 11 16 11 16 Z" fill="url(#shieldBody)" />
      <path d="M32 7 L53 16 C53 16 54 28 32 40 C10 28 11 16 11 16 Z" fill="url(#shieldHighlight)" />
      <path d="M28 28 L32 34 L40 22" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function DadosTecnicosPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 via-white to-violet-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      <div className="container mx-auto px-4 py-16 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-violet-100 dark:bg-gray-700 rounded-full">
              <RealisticShield className="h-14 w-14" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Coleta de Dados Técnicos
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Transparência total sobre como coletamos e protegemos suas informações técnicas
          </p>
        </div>

        {/* Introdução */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Por que coletamos dados técnicos?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              A <strong>VolatusPay</strong> coleta informações técnicas do seu dispositivo
              exclusivamente para garantir a <strong>segurança da plataforma</strong> e
              <strong> prevenir fraudes</strong>.
            </p>
            <p className="text-gray-700 dark:text-gray-300">
              Estas informações são coletadas <strong>apenas de sellers cadastrados</strong> que
              <strong> aceitaram nossos Termos de Uso</strong> durante o cadastro.
            </p>
            <div className="bg-violet-50 dark:bg-violet-950/20 p-4 rounded-lg border border-violet-200 dark:border-[#f0f4ff]">
              <p className="text-sm text-[#f0f4ff] dark:text-blue-300">
                <strong>Conformidade LGPD/GDPR:</strong> Coletamos APENAS dados essenciais,
                aplicamos hash irreversível em dados sensíveis e minimizamos o rastreamento.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Dados Coletados */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Quais dados técnicos coletamos?
            </CardTitle>
            <CardDescription>
              Apenas informações essenciais do dispositivo (minimização de dados)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Rede */}
              <div>
                <h3 className="font-semibold text-violet-600 dark:text-blue-400 mb-2">
                  Informações de Rede
                </h3>
                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                  <li>Endereço IP (anonimizado com hash no backend)</li>
                  <li>Navegador e versão (ex: Chrome 120)</li>
                  <li>User Agent (anonimizado com hash irreversível SHA-256)</li>
                </ul>
              </div>

              {/* Sistema */}
              <div>
                <h3 className="font-semibold text-violet-600 dark:text-blue-400 mb-2">
                  Informações do Sistema
                </h3>
                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                  <li>Sistema operacional (ex: Windows 10, macOS)</li>
                  <li>Navegador (ex: Chrome, Firefox, Safari)</li>
                </ul>
              </div>

              {/* Hardware */}
              <div>
                <h3 className="font-semibold text-violet-600 dark:text-blue-400 mb-2">
                  Informações de Hardware (essenciais)
                </h3>
                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                  <li>Resolução da tela (ex: 1920x1080)</li>
                  <li>Quantidade de núcleos do processador</li>
                  <li>Memória RAM total (se disponível pelo navegador)</li>
                </ul>
              </div>

              {/* Localização */}
              <div>
                <h3 className="font-semibold text-violet-600 dark:text-blue-400 mb-2">
                  Informações de Localização
                </h3>
                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                  <li>Fuso horário (timezone)</li>
                  <li>Idioma do navegador</li>
                  <li>País e cidade (derivados do IP, sem GPS)</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 bg-violet-50 dark:bg-violet-950/20 p-4 rounded-lg border border-violet-200 dark:border-[#f0f4ff]">
              <p className="text-sm text-[#f0f4ff] dark:text-blue-300">
                <strong>NÃO COLETAMOS:</strong> Bateria, fontes instaladas, plugins,
                IP local (WebRTC), canvas fingerprint, dados de conexão detalhados,
                ou qualquer dado que não seja essencial para segurança.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Finalidade */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Para que usamos esses dados?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-gray-700 dark:text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-violet-600 dark:text-blue-400 mt-1">✓</span>
                <span><strong>Prevenção de fraudes:</strong> Detectar acessos suspeitos e atividades maliciosas</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-600 dark:text-blue-400 mt-1">✓</span>
                <span><strong>Segurança da plataforma:</strong> Identificar múltiplos cadastros do mesmo dispositivo</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-600 dark:text-blue-400 mt-1">✓</span>
                <span><strong>Análise de risco:</strong> Avaliar o perfil de risco de cada seller</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-600 dark:text-blue-400 mt-1">✓</span>
                <span><strong>Proteção de todos:</strong> Garantir um ambiente seguro para compradores e vendedores</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Segurança */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Como protegemos seus dados?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-gray-700 dark:text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-violet-600 dark:text-blue-400 mt-1">✓</span>
                <span><strong>Hash irreversível:</strong> Dados sensíveis (User Agent, IP) são anonimizados com SHA-256</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-600 dark:text-blue-400 mt-1">✓</span>
                <span><strong>Minimização de dados:</strong> Coletamos apenas o essencial (LGPD/GDPR)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-600 dark:text-blue-400 mt-1">✓</span>
                <span><strong>Criptografia:</strong> Todos os dados são criptografados em trânsito (TLS 1.2+) e em repouso (AES-256)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-600 dark:text-blue-400 mt-1">✓</span>
                <span><strong>Acesso restrito:</strong> Apenas administradores autorizados podem visualizar</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-600 dark:text-blue-400 mt-1">✓</span>
                <span><strong>Não compartilhamos:</strong> Seus dados técnicos NUNCA são vendidos ou compartilhados com terceiros</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-600 dark:text-blue-400 mt-1">✓</span>
                <span><strong>Armazenamento seguro:</strong> Firebase com certificação SOC 2 Type 2</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Direitos */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5" />
              Seus direitos (LGPD/GDPR)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              De acordo com a LGPD (Lei Geral de Proteção de Dados) e GDPR, você tem direito a:
            </p>
            <ul className="space-y-2 text-gray-700 dark:text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 dark:text-blue-400">→</span>
                <span><strong>Acessar:</strong> Solicitar cópia dos dados que coletamos sobre você</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 dark:text-blue-400">→</span>
                <span><strong>Corrigir:</strong> Atualizar dados incorretos ou incompletos</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 dark:text-blue-400">→</span>
                <span><strong>Excluir:</strong> Solicitar a exclusão dos seus dados técnicos</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 dark:text-blue-400">→</span>
                <span><strong>Revogar consentimento:</strong> Retirar autorização a qualquer momento</span>
              </li>
            </ul>
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              Para exercer seus direitos, entre em contato: <strong>volatuspay@gmail.com</strong>
            </p>
          </CardContent>
        </Card>

        {/* Consentimento */}
        <Card className="mb-8 border-violet-200 dark:border-[#f0f4ff] bg-violet-50 dark:bg-violet-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Consentimento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Ao aceitar os <strong>Termos de Uso</strong> durante seu cadastro como seller,
              você está automaticamente autorizando a coleta desses dados técnicos.
            </p>
            <p className="text-gray-700 dark:text-gray-300">
              A coleta é <strong>vinculada ao cadastro como seller</strong>, caso não aceite os termos,
              você não poderá se cadastrar como vendedor, mas poderá continuar usando a plataforma como comprador.
            </p>
          </CardContent>
        </Card>

        {/* Atualização */}
        <div className="text-center text-sm text-gray-600 dark:text-gray-400">
          <p>Última atualização: {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
          <p className="mt-2">
            Dúvidas? Entre em contato: <a href="mailto:volatuspay@gmail.com" className="text-violet-600 dark:text-blue-400 hover:underline">volatuspay@gmail.com</a>
          </p>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
