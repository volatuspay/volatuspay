import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/login-form';
import { LogoThemed } from '@/components/ui/logo-themed';
import { SiteFooter } from '@/components/layout/site-footer';

export default function Compliance() {
  const [showLogin, setShowLogin] = useState(false);
  
  return (
    <div className="min-h-screen bg-gray-50" data-testid="docs-page">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <a href="/" className="flex items-center">
              <LogoThemed type="site" variant="light" className="h-8 w-auto" fallbackText="VolatusPay" />
            </a>
            
            <nav className="hidden md:flex items-center gap-8">
              <a href="/" className="text-gray-600 hover:text-muted-foreground transition-colors font-medium">Início</a>
              <a href="/#taxas" className="text-gray-600 hover:text-muted-foreground transition-colors font-medium">Taxas</a>
              <a href="/#contato" className="text-gray-600 hover:text-muted-foreground transition-colors font-medium">Contato</a>
            </nav>

            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setShowLogin(true)} className="text-gray-900 hover:bg-gray-100">
                Entrar
              </Button>
              <Button className="bg-violet-500 hover:bg-violet-600" onClick={() => window.location.href = '/register'}>
                Criar Conta
              </Button>
            </div>
          </div>
        </div>
      </header>
      
      <div className="py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow-sm p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">Compliance e Segurança</h1>
            
            <div className="prose prose-gray max-w-none">
              <p className="text-sm text-gray-600 mb-6">
                <strong>Última atualização:</strong> Março de 2026
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">1. Certificações e Conformidade</h2>
              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">1.1 PCI DSS</h3>
              <p className="mb-4">
                A VolatusPay opera em conformidade com o padrão PCI DSS (Payment Card Industry Data Security
                Standard). Dados de cartão de crédito são processados exclusivamente pelos nossos adquirentes
                certificados, EfíBank (Efí S.A.), Stripe e PagarMe -, que possuem certificação PCI DSS Level 1,
                o mais alto nível existente. A VolatusPay <strong>nunca armazena, transmite diretamente
                ou processa dados de cartão</strong>, atuando como facilitadora e submetendo-se aos controles
                de segurança exigidos para plataformas no escopo SAQ-A.
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Dados de cartão processados sob infraestrutura PCI DSS Level 1 dos adquirentes</li>
                <li>Criptografia de dados em trânsito (TLS 1.2+) e em repouso (AES-256)</li>
                <li>Tokenização de informações sensíveis pelos adquirentes</li>
                <li>Monitoramento contínuo de segurança e acesso</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">1.2 LGPD (Lei Geral de Proteção de Dados)</h3>
              <p className="mb-4">
                Estamos em total conformidade com a LGPD brasileira (Lei 13.709/2018):
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Encarregado de Dados (DPO) devidamente nomeado</li>
                <li>Políticas de privacidade transparentes e acessíveis</li>
                <li>Processos documentados para exercício de direitos dos titulares</li>
                <li>Relatórios de impacto elaborados quando necessários</li>
                <li>Contratos com operadores e suboperadores de dados</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">2. Prevenção à Lavagem de Dinheiro</h2>
              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">2.1 KYC (Know Your Customer)</h3>
              <p className="mb-4">
                Implementamos rigorosos processos de identificação em conformidade com a Lei 9.613/1998
                e as normas do Banco Central do Brasil:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Verificação de identidade obrigatória para todos os vendedores</li>
                <li>Validação de documentos oficiais (RG, CNH, CNPJ)</li>
                <li>Consulta a bases de dados oficiais e listas restritivas</li>
                <li>Análise de risco individualizada para cada cliente</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">2.2 Monitoramento de Transações</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Análise em tempo real de padrões suspeitos</li>
                <li>Alertas automáticos para transações atípicas ou de alto valor</li>
                <li>Comunicações ao COAF quando exigido pela regulamentação vigente</li>
                <li>Bloqueio preventivo de operações suspeitas pendentes de análise</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">3. Prevenção a Fraudes</h2>
              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">3.1 Sistemas de Detecção</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Machine Learning para análise comportamental e detecção de anomalias</li>
                <li>Verificação de velocidade e frequência de transações</li>
                <li>Análise geográfica de compras e acessos</li>
                <li>Validação de dispositivos, impressão digital do navegador e endereço IP</li>
                <li>Firewall de aplicação web (WAF) e sistema de detecção de intrusões (IDS/IPS)</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">3.2 Regras de Uso Aceitável dos Adquirentes</h3>
              <p className="mb-4">
                Todos os vendedores da plataforma estão sujeitos às políticas de uso aceitável dos nossos
                adquirentes parceiros. Produtos ou práticas que violem essas políticas resultam em suspensão
                imediata da conta, independentemente de aviso prévio.
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>EfíBank / Efí S.A.:</strong> Segue as normas do Banco Central e bandeiras Visa/Mastercard nacionais</li>
                <li><strong>Woovi:</strong> Segue as normas do Banco Central para transações PIX</li>
                <li><strong>Stripe:</strong> Sujeito às Políticas de Uso Aceitável da Stripe (stripe.com/br/legal/restricted-businesses)</li>
                <li><strong>PagarMe:</strong> Sujeito às políticas de produtos restritos e proibidos da PagarMe / Stone Co.</li>
              </ul>

              <p className="mb-4">Para questões relacionadas a compliance e segurança:</p>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p><strong>Razão Social:</strong> VOLATUSPAY TECNOLOGIA DE PAGAMENTOS LTDA</p>
                <p><strong>CNPJ:</strong> 60.416.460/0001-27</p>
                <p><strong>E-mail:</strong> volatuspay@gmail.com</p>
                <p><strong>WhatsApp:</strong> (15) 99800-0086</p>
                <p><strong>Encarregado LGPD (DPO):</strong> volatuspay@gmail.com</p>
                <p><strong>Canal de Denúncias:</strong> volatuspay@gmail.com</p>
              </div>

              <div className="mt-8 p-4 bg-violet-50 border border-violet-200 rounded-lg">
                <p className="text-sm text-[#f0f4ff]">
                  <strong>Conformidades Ativas:</strong> LGPD Compliant | PCI DSS SAQ-A (via adquirentes certificados Level 1) | Marco Civil da Internet | Lei 9.613/1998 (COAF)
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SiteFooter />

      <Dialog open={showLogin} onOpenChange={setShowLogin}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Entrar na sua conta</DialogTitle>
            <DialogDescription>Digite suas credenciais para acessar sua conta</DialogDescription>
          </DialogHeader>
          <LoginForm compact onClose={() => setShowLogin(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
