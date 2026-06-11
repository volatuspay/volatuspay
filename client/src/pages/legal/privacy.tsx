import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/login-form';
import { LogoThemed } from '@/components/ui/logo-themed';
import { SiteFooter } from '@/components/layout/site-footer';

export default function Privacy() {
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
            <h1 className="text-3xl font-bold text-gray-900 mb-8">Política de Privacidade</h1>
            
            <div className="prose prose-gray max-w-none">
              <p className="text-sm text-gray-600 mb-6">
                <strong>Última atualização:</strong> Março de 2026
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">1. Informações Gerais</h2>
              <p className="mb-4">
                A VOLATUSPAY TECNOLOGIA DE PAGAMENTOS LTDA está comprometida em proteger e
                respeitar sua privacidade, em conformidade com a Lei Geral de Proteção de Dados (LGPD, Lei
                13.709/2018) e demais legislações aplicáveis. Esta política explica como coletamos, usamos,
                armazenamos e protegemos suas informações pessoais.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">2. Informações que Coletamos</h2>
              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">2.1 Dados de Identificação</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Nome completo</li>
                <li>CPF ou CNPJ</li>
                <li>Endereço de e-mail</li>
                <li>Número de telefone / WhatsApp</li>
                <li>Endereço completo (para verificação de identidade)</li>
                <li>Data de nascimento (para verificação de maioridade)</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">2.2 Dados Financeiros</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Dados bancários para recebimentos (chave PIX, agência, conta)</li>
                <li>Informações de transações realizadas na plataforma</li>
                <li>Histórico de vendas, saques e comissões</li>
                <li>Dados de cartão de crédito, processados diretamente pelos adquirentes, <strong>nunca armazenados pela VolatusPay</strong></li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">2.3 Dados Técnicos de Segurança</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Endereço IP (anonimizado com hash SHA-256 no backend)</li>
                <li>User Agent do navegador (anonimizado)</li>
                <li>Sistema operacional e versão do navegador</li>
                <li>Resolução de tela e fuso horário</li>
                <li>Logs de acesso e sessões autenticadas</li>
                <li>Cookies essenciais e de segurança</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">2.4 Dados de Compradores</h3>
              <p className="mb-4">
                Para processar transações de compra, coletamos dos compradores:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Nome completo e e-mail</li>
                <li>CPF/CNPJ (obrigatório para PIX e boleto, conforme regulamentação do Banco Central)</li>
                <li>Telefone (para notificações e suporte)</li>
                <li>Endereço (para emissão de nota fiscal quando aplicável)</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">3. Como Usamos suas Informações</h2>
              <ul className="list-disc pl-6 mb-4">
                <li>Processar pagamentos e transações financeiras</li>
                <li>Verificar identidade e prevenir fraudes (Anti-Fraud / KYC)</li>
                <li>Cumprir obrigações legais, regulamentares e fiscais</li>
                <li>Fornecer suporte ao cliente e responder a solicitações</li>
                <li>Enviar comunicações essenciais sobre sua conta (confirmações de pagamento, alertas de segurança)</li>
                <li>Melhorar continuamente nossos serviços e experiência do usuário</li>
                <li>Detectar e prevenir atividades suspeitas, fraudes e lavagem de dinheiro</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">4. Compartilhamento de Dados</h2>
              <p className="mb-4">
                Compartilhamos suas informações apenas nas seguintes situações e com as seguintes entidades:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>EfíBank (Efí S.A.)</strong>, para processamento de PIX, boleto e cartões nacionais</li>
                <li><strong>Woovi</strong>, para processamento de PIX instantâneo</li>
                <li><strong>Stripe, Inc.</strong>, para processamento de cartões internacionais</li>
                <li><strong>PagarMe</strong>, para processamento de cartões e boletos nacionais</li>
                <li><strong>Firebase / Google Cloud</strong>, para armazenamento seguro de dados e autenticação</li>
                <li><strong>Bunny CDN</strong>, para entrega de conteúdo digital (vídeos, arquivos)</li>
                <li><strong>Resend</strong>, para envio de e-mails transacionais</li>
                <li><strong>Autoridades competentes</strong>, quando exigido por lei, ordem judicial, COAF ou Banco Central</li>
              </ul>
              <p className="mb-4">
                Todos os parceiros possuem contratos de confidencialidade e tratam seus dados em conformidade com suas respectivas políticas de privacidade.
                <strong> Nunca vendemos seus dados pessoais a terceiros.</strong>
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">5. Segurança dos Dados</h2>
              <p className="mb-4">
                Implementamos múltiplas camadas de segurança técnica e organizacional:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Transmissão exclusiva via HTTPS (TLS 1.2+)</li>
                <li>Dados de cartão processados sob infraestrutura PCI DSS dos adquirentes (Stripe, EfíBank)</li>
                <li>Criptografia AES-256 para dados sensíveis em repouso</li>
                <li>Autenticação de dois fatores (2FA) disponível para todos os sellers</li>
                <li>Monitoramento contínuo com detecção de intrusões (IDS/IPS)</li>
                <li>Firewall de aplicação web (WAF) e proteção contra ataques DDoS</li>
                <li>Anonimização de dados técnicos sensíveis via SHA-256</li>
                <li>Backups seguros e regulares com retenção controlada</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">6. Seus Direitos (LGPD)</h2>
              <p className="mb-4">
                Conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018), você tem direito a:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Confirmar a existência de tratamento de seus dados pessoais</li>
                <li>Acessar os dados que possuímos sobre você</li>
                <li>Corrigir dados incompletos, inexatos ou desatualizados</li>
                <li>Solicitar anonimização, bloqueio ou eliminação de dados desnecessários</li>
                <li>Solicitar portabilidade dos dados para outra plataforma</li>
                <li>Revogar consentimento a qualquer momento (sem efeito retroativo)</li>
                <li>Obter informações sobre o compartilhamento dos seus dados</li>
                <li>Peticionar perante a ANPD (Autoridade Nacional de Proteção de Dados)</li>
              </ul>
              <p className="mb-4">
                Para exercer seus direitos, envie e-mail para <strong>volatuspay@gmail.com</strong> com
                o assunto "LGPD, Exercício de Direitos". Responderemos em até 15 (quinze) dias úteis.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">7. Retenção de Dados</h2>
              <p className="mb-4">
                Mantemos seus dados pelo tempo necessário para cumprir as finalidades descritas:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Dados fiscais e de transações: 5 (cinco) anos (obrigação legal, Lei 9.394/1996 e regulamentação Receita Federal)</li>
                <li>Registros de acesso (logs): 6 (seis) meses (Marco Civil da Internet, Lei 12.965/2014)</li>
                <li>Dados de prevenção à fraude: até 2 (dois) anos após encerramento da conta</li>
                <li>Dados bancários para saques: enquanto houver saldo pendente a ser liberado</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">8. Cookies</h2>
              <p className="mb-4">
                Utilizamos cookies e tecnologias similares para:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Cookies essenciais:</strong> sessão autenticada, preferências de segurança, não podem ser desativados</li>
                <li><strong>Cookies de preferências:</strong> tema (claro/escuro), idioma, configurações de exibição</li>
                <li><strong>Cookies analíticos:</strong> métricas de uso anônimas para melhorar o serviço</li>
              </ul>
              <p className="mb-4">
                Não utilizamos cookies de rastreamento comportamental de terceiros para publicidade.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">9. Transferência Internacional de Dados</h2>
              <p className="mb-4">
                Alguns de nossos parceiros (Stripe, Firebase/Google, Bunny CDN) processam dados fora do Brasil.
                Todas as transferências são realizadas com garantias adequadas de proteção, incluindo cláusulas
                contratuais padrão e certificações reconhecidas internacionalmente, conforme exigido pelo Art. 33 da LGPD.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">10. Alterações nesta Política</h2>
              <p className="mb-4">
                Esta política pode ser atualizada periodicamente para refletir mudanças em nossas práticas ou
                requisitos legais. Notificaremos sobre mudanças significativas com antecedência mínima de 15 dias
                por e-mail e aviso na plataforma.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">11. Encarregado de Dados (DPO)</h2>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p><strong>Razão Social:</strong> VOLATUSPAY TECNOLOGIA DE PAGAMENTOS LTDA</p>
                <p><strong>CNPJ:</strong> 60.416.460/0001-27</p>
                <p><strong>Encarregado LGPD (DPO):</strong> volatuspay@gmail.com</p>
                <p><strong>E-mail de Privacidade:</strong> volatuspay@gmail.com</p>
                <p><strong>WhatsApp:</strong> (15) 99800-0086</p>
                <p><strong>Canal de Denúncias:</strong> volatuspay@gmail.com</p>
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
