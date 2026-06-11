import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/login-form';
import { LogoThemed } from '@/components/ui/logo-themed';
import { SiteFooter } from '@/components/layout/site-footer';

export default function Terms() {
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
            <h1 className="text-3xl font-bold text-gray-900 mb-8">Termos de Uso</h1>
            
            <div className="prose prose-gray max-w-none">
              <p className="text-sm text-gray-600 mb-6">
                <strong>Última atualização:</strong> Março de 2026
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">1. Aceitação dos Termos</h2>
              <p className="mb-4">
                Ao utilizar a plataforma VolatusPay, você concorda integralmente com estes Termos de Uso.
                Se não concordar com qualquer disposição, não utilize nossos serviços.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">2. Descrição dos Serviços</h2>
              <p className="mb-4">
                A VolatusPay é uma plataforma de pagamentos e gestão de vendas digitais que oferece:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Processamento de pagamentos via PIX, cartão de crédito e boleto bancário</li>
                <li>Área de membros integrada para produtos digitais</li>
                <li>Gestão de assinaturas recorrentes</li>
                <li>Ferramentas de checkout otimizado com order bumps e upsells</li>
                <li>Dashboard de analytics, vendas e comissões de afiliados</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">3. Elegibilidade e Cadastro</h2>
              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">3.1 Requisitos</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Ser maior de 18 anos ou pessoa jurídica regularmente constituída</li>
                <li>Possuir CPF ou CNPJ válido e em situação regular na Receita Federal</li>
                <li>Fornecer informações verdadeiras, completas e atualizadas</li>
                <li>Possuir conta bancária ou chave PIX em seu nome para recebimentos</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">3.2 Verificação de Identidade (KYC)</h3>
              <p className="mb-4">
                Reservamo-nos o direito de verificar informações fornecidas e solicitar documentação
                adicional (RG, CNH, comprovante de residência, contrato social) para validar sua identidade e atividade comercial,
                conforme exigências do Banco Central do Brasil e legislação de prevenção à lavagem de dinheiro (Lei 9.613/1998).
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">4. Produtos e Serviços Permitidos</h2>
              <p className="mb-4">
                Nossa plataforma aceita apenas produtos e serviços lícitos. São permitidos:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Produtos digitais educacionais (cursos, treinamentos, mentorias)</li>
                <li>E-books, audiobooks e conteúdo digital em geral</li>
                <li>Softwares, aplicativos e ferramentas digitais</li>
                <li>Serviços de consultoria e assessoria</li>
                <li>Assinaturas de conteúdo e comunidades</li>
                <li>Eventos, workshops e experiências presenciais ou online</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">5. Produtos e Atividades Proibidas</h2>
              <p className="mb-4">
                <strong>É ESTRITAMENTE PROIBIDO</strong> utilizar nossa plataforma para:
              </p>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">5.1 Conteúdo Adulto e Sexual</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Produtos ou serviços para adultos (+18) de qualquer natureza</li>
                <li>Conteúdo pornográfico, erótico ou sexualmente explícito</li>
                <li>Serviços de acompanhantes ou afins</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">5.2 Atividades Ilegais</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Venda de armas, munições, explosivos ou similares</li>
                <li>Drogas ilícitas ou substâncias controladas sem autorização</li>
                <li>Medicamentos sem prescrição ou registro na ANVISA</li>
                <li>Documentos falsificados ou adulterados</li>
                <li>Produtos pirateados ou com violação de direitos autorais</li>
                <li>Produtos sem origem comprovada (receptação)</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">5.3 Jogos e Apostas</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Cassinos online não autorizados pelo governo federal</li>
                <li>Jogos de azar ilegais</li>
                <li>Loterias não autorizadas pelo governo</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">5.4 Esquemas Fraudulentos</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Pirâmides financeiras e esquemas Ponzi</li>
                <li>Marketing multinível sem produto real</li>
                <li>Investimentos não regulamentados pela CVM/Banco Central</li>
                <li>Serviços de "renda garantida" sem embasamento legal</li>
                <li>Qualquer prática de phishing ou coleta fraudulenta de dados</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">6. Taxas e Pagamentos</h2>
              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">6.1 Taxa PIX</h3>
              <p className="mb-4">R$ 2,49 + 2% por transação aprovada</p>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">6.2 Taxa Cartão de Crédito</h3>
              <p className="mb-4">5,99% + R$ 0,39 por transação aprovada</p>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">6.3 Boleto Bancário</h3>
              <p className="mb-4">R$ 3,49 por boleto pago</p>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">6.4 Repasses</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>PIX: D+0 (imediato após confirmação do pagamento)</li>
                <li>Cartão: D+30 (trinta dias corridos após a venda)</li>
                <li>Boleto: D+3 após compensação bancária</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">6.5 Reserva Técnica</h3>
              <p className="mb-4">
                Nos primeiros 90 dias de operação ou em caso de índice de chargeback elevado, podemos reter
                até 10% das transações por até 30 dias como reserva técnica para cobertura de eventuais contestações.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">7. Obrigações do Usuário</h2>
              <ul className="list-disc pl-6 mb-4">
                <li>Manter informações cadastrais precisas e atualizadas</li>
                <li>Cumprir todas as leis aplicáveis, inclusive fiscais e tributárias</li>
                <li>Emitir nota fiscal quando exigido por lei</li>
                <li>Não realizar atividades fraudulentas ou enganosas</li>
                <li>Proteger credenciais de acesso e não compartilhá-las</li>
                <li>Notificar imediatamente sobre uso não autorizado da conta</li>
                <li>Fornecer atendimento adequado e suporte aos compradores</li>
                <li>Honrar a política de reembolso de 7 dias (CDC Art. 49) para compras realizadas fora do estabelecimento comercial</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">8. Chargebacks e Disputas</h2>
              <p className="mb-4">
                O vendedor é responsável pelas contestações (chargebacks) originadas de suas vendas. Aplicam-se os seguintes limites:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Alerta:</strong> Taxa de chargeback acima de 1% das transações mensais</li>
                <li><strong>Monitoramento intensificado:</strong> Acima de 1,5%, reserva técnica pode ser aplicada</li>
                <li><strong>Suspensão:</strong> Acima de 2% por dois meses consecutivos</li>
                <li>Taxa administrativa de R$ 25,00 por chargeback recebido, independente do resultado da defesa</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">9. Suspensão e Encerramento</h2>
              <p className="mb-4">
                Podemos suspender ou encerrar sua conta em caso de:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Violação destes Termos de Uso</li>
                <li>Atividade suspeita, fraudulenta ou ilegal</li>
                <li>Índice elevado de chargebacks ou reembolsos</li>
                <li>Solicitação de autoridades competentes (Polícia Federal, COAF, Banco Central)</li>
                <li>Não fornecimento de documentação solicitada em até 5 dias úteis</li>
                <li>Inatividade por período superior a 24 meses</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">10. Limitação de Responsabilidade</h2>
              <p className="mb-4">
                A VolatusPay não se responsabiliza por:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>Qualidade, legalidade ou adequação dos produtos e serviços vendidos pelos usuários</li>
                <li>Disputas entre vendedores e compradores sobre o produto entregue</li>
                <li>Problemas técnicos ou interrupções de serviços de terceiros (operadoras, bancos)</li>
                <li>Perdas decorrentes de uso inadequado da plataforma ou descuido com credenciais</li>
                <li>Variações cambiais ou alterações em taxas de adquirentes</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">11. Propriedade Intelectual</h2>
              <p className="mb-4">
                Todos os direitos de propriedade intelectual da plataforma VolatusPay pertencem exclusivamente à empresa.
                É proibido copiar, modificar, distribuir, fazer engenharia reversa ou sublicenciar nosso conteúdo sem autorização expressa e por escrito.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">12. Processadores de Pagamento</h2>
              <p className="mb-4">
                A VolatusPay opera em conjunto com os seguintes processadores de pagamento, cada qual sujeito aos seus próprios termos e políticas:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>EfíBank (Efí S.A.)</strong>, PIX, boleto e cartão de crédito no Brasil</li>
                <li><strong>Woovi</strong>, PIX instantâneo</li>
                <li><strong>Stripe</strong>, Cartões internacionais</li>
                <li><strong>PagarMe</strong>, Cartões e boletos nacionais</li>
              </ul>
              <p className="mb-4">O vendedor reconhece estar sujeito também às políticas de uso aceitável desses processadores,
                especialmente no que se refere a produtos proibidos e limites de chargeback.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">13. Alterações nos Termos</h2>
              <p className="mb-4">
                Reservamo-nos o direito de modificar estes Termos a qualquer momento.
                Alterações significativas serão comunicadas com antecedência mínima de 30 (trinta) dias
                por e-mail e notificação na plataforma. O uso continuado após a vigência das alterações
                implica aceitação dos novos termos.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">14. Lei Aplicável e Foro</h2>
              <p className="mb-4">
                Estes Termos são regidos pela legislação da República Federativa do Brasil.
                Fica eleito o foro da Comarca de São Paulo/SP para dirimir quaisquer controvérsias
                decorrentes deste instrumento, com renúncia expressa a qualquer outro, por mais privilegiado que seja.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">15. Contato</h2>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p><strong>Razão Social:</strong> VOLATUSPAY TECNOLOGIA DE PAGAMENTOS LTDA</p>
                <p><strong>CNPJ:</strong> 60.416.460/0001-27</p>
                <p><strong>E-mail:</strong> volatuspay@gmail.com</p>
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
