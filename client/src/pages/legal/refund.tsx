import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoginForm } from '@/components/auth/login-form';
import { LogoThemed } from '@/components/ui/logo-themed';
import { SiteFooter } from '@/components/layout/site-footer';

export default function Refund() {
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
            <h1 className="text-3xl font-bold text-gray-900 mb-8">Política de Reembolso</h1>
            
            <div className="prose prose-gray max-w-none">
              <p className="text-sm text-gray-600 mb-6">
                <strong>Última atualização:</strong> Março de 2026
              </p>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <p className="text-amber-800 font-semibold">
                  IMPORTANTE: Reembolsos são processados apenas dentro de 7 dias corridos após a compra,
                  conforme o Código de Defesa do Consumidor (CDC, Art. 49).
                </p>
              </div>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">1. Prazo para Solicitação</h2>
              <p className="mb-4">
                <strong>Prazo máximo:</strong> 7 (sete) dias corridos a partir da data da compra aprovada.
              </p>
              <p className="mb-4">
                Solicitações fora deste prazo <strong>NÃO SERÃO ACEITAS</strong>, conforme permitido pelo
                Código de Defesa do Consumidor para produtos digitais adquiridos à distância.
              </p>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">2. Produtos Elegíveis</h2>
              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">2.1 Produtos Digitais</h3>
              <p className="mb-4">
                Reembolso permitido apenas se:
              </p>
              <ul className="list-disc pl-6 mb-4">
                <li>O produto não foi acessado ou baixado</li>
                <li>Compra realizada por engano ou duplicada</li>
                <li>Problema técnico comprovado que impeça o acesso</li>
                <li>Produto significativamente diferente do anunciado</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">2.2 Assinaturas</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Cancelamento dentro de 7 dias da primeira cobrança</li>
                <li>Reembolso proporcional se não houve uso do serviço</li>
                <li>Assinaturas anuais: reembolso proporcional aos meses não utilizados</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">3. Produtos NÃO Elegíveis</h2>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <p className="text-red-800 font-semibold mb-2">REEMBOLSO NÃO PERMITIDO:</p>
                <ul className="list-disc pl-6 text-red-700">
                  <li>Produtos digitais já acessados ou baixados</li>
                  <li>Cursos com aulas já assistidas</li>
                  <li>E-books já baixados ou lidos</li>
                  <li>Softwares já ativados</li>
                  <li>Serviços já prestados</li>
                  <li>Produtos personalizados sob medida</li>
                  <li>Solicitações após 7 dias da compra</li>
                </ul>
              </div>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">4. Como Solicitar</h2>
              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">4.1 Canais de Atendimento</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p><strong>E-mail:</strong> volatuspay@gmail.com</p>
                <p><strong>WhatsApp:</strong> (15) 99800-0086</p>
                <p><strong>Horário:</strong> Segunda a Sexta, 9h às 18h</p>
              </div>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">4.2 Informações Necessárias</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>ID da transação ou e-mail de confirmação da compra</li>
                <li>CPF/CNPJ do comprador</li>
                <li>Motivo detalhado da solicitação</li>
                <li>Dados bancários para estorno (se aplicável)</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">5. Processo de Análise</h2>
              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">5.1 Prazos</h3>
              <ul className="list-disc pl-6 mb-4">
                <li><strong>Análise:</strong> Até 3 dias úteis</li>
                <li><strong>Resposta:</strong> Por e-mail cadastrado</li>
                <li><strong>Processamento:</strong> Até 5 dias úteis após aprovação</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">5.2 Critérios de Aprovação</h3>
              <ul className="list-disc pl-6 mb-4">
                <li>Solicitação dentro do prazo (7 dias corridos)</li>
                <li>Motivo válido e comprovado</li>
                <li>Produto elegível para reembolso</li>
                <li>Ausência de uso ou consumo do produto</li>
              </ul>

              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">6. Contato</h2>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p><strong>Razão Social:</strong> VOLATUSPAY TECNOLOGIA DE PAGAMENTOS LTDA</p>
                <p><strong>CNPJ:</strong> 60.416.460/0001-27</p>
                <p><strong>E-mail:</strong> volatuspay@gmail.com</p>
                <p><strong>Denúncias:</strong> volatuspay@gmail.com</p>
                <p><strong>WhatsApp:</strong> (15) 99800-0086</p>
                <p><strong>Horário:</strong> Segunda a Sexta, 9h às 18h</p>
              </div>

              <div className="mt-8 p-4 bg-gray-100 rounded-lg">
                <p className="text-sm text-gray-600">
                  <strong>Lembre-se:</strong> Você tem apenas 7 dias corridos para solicitar reembolso.
                  Após este prazo, a solicitação será automaticamente negada.
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
