import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { Building2, CreditCard, UserPlus, Store } from "lucide-react";

export default function Subscriptions() {
  const [showLogin, setShowLogin] = useState(false);
  const [showRegisterChoice, setShowRegisterChoice] = useState(false);
  const [showRegisterCustomer, setShowRegisterCustomer] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50" data-testid="docs-page">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-emerald-600 via-pink-500 to-[#f0f4ff] rounded-lg flex items-center justify-center shadow-lg">
                <CreditCard className="h-5 w-5 text-white" />
              </div>
              <a href="/" className="text-xl font-bold bg-gradient-to-r from-emerald-600 to-emerald-700 bg-clip-text text-transparent">
                VolatusPay
              </a>
            </div>
            
            <nav className="hidden md:flex items-center gap-8">
              <a href="/#inicio" className="text-gray-700 hover:text-muted-foreground transition-colors font-medium">Início</a>
              <a href="/#taxas" className="text-gray-700 hover:text-muted-foreground transition-colors font-medium">Taxas</a>
              <a href="/#whitelabel" className="text-gray-700 hover:text-muted-foreground transition-colors font-medium">Whitelabel</a>
              <a href="/#contato" className="text-gray-700 hover:text-muted-foreground transition-colors font-medium">Contato</a>
            </nav>

            <div className="flex gap-3">
              <Button 
                variant="ghost" 
                onClick={() => setShowLogin(true)}
                data-testid="button-login"
              >
                Entrar
              </Button>
              <Button 
                className="bg-emerald-500 hover:bg-emerald-500" 
                onClick={() => setShowRegisterChoice(true)}
                data-testid="button-register"
              >
                Registro
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Sistema de Assinaturas</h1>
          
          <div className="prose prose-gray max-w-none">
            <p className="text-lg text-gray-600 mb-8">
              Crie negcios recorrentes com nosso sistema completo de assinaturas. 
              Venda para o Brasil ou globalmente com controle total sobre seus assinantes.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Configuração Geogrfica</h2>
            
            <div className="grid md:grid-cols-2 gap-6 mt-6">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Vendas Nacionais</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li>Pagamentos em Real (BRL)</li>
                  <li>PIX instantneo</li>
                  <li>Cartão de crédito nacional</li>
                  <li>Boleto bancário (opcional)</li>
                  <li>Compliance brasileiro</li>
                  <li>Nota fiscal automática</li>
                </ul>
              </div>

              <div className="bg-emerald-50 border border-blue-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Vendas Globais</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li>Pagamentos em USD/EUR</li>
                  <li>Cartão internacional via Stripe</li>
                  <li>PayPal (em breve)</li>
                  <li>Apple Pay / Google Pay</li>
                  <li>Compliance internacional</li>
                  <li>Multi-idiomas</li>
                </ul>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Perodos de Cobrança</h2>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
              <div className="bg-emerald-50 p-4 rounded-lg text-center">
                <h3 className="text-lg font-semibold text-muted-foreground mb-2">Mensal</h3>
                <p className="text-muted-foreground text-sm">Cobrança a cada 30 dias</p>
                <p className="text-muted-foreground font-semibold mt-2">Ideal para testes</p>
              </div>

              <div className="bg-emerald-50 p-4 rounded-lg text-center">
                <h3 className="text-lg font-semibold text-muted-foreground mb-2">Dados Trimestral</h3>
                <p className="text-muted-foreground text-sm">Cobrança a cada 90 dias</p>
                <p className="text-muted-foreground font-semibold mt-2">Mais estabilidade</p>
              </div>

              <div className="bg-emerald-50 p-4 rounded-lg text-center">
                <h3 className="text-lg font-semibold text-muted-foreground mb-2">Semestral</h3>
                <p className="text-muted-foreground text-sm">Cobrança a cada 180 dias</p>
                <p className="text-muted-foreground font-semibold mt-2">Desconto atrativo</p>
              </div>

              <div className="bg-emerald-50 p-4 rounded-lg text-center">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Anual</h3>
                <p className="text-muted-foreground text-sm">Cobrança a cada 365 dias</p>
                <p className="text-muted-foreground font-semibold mt-2">Máximo desconto</p>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Dados Controle de Assinaturas</h2>
            
            <p className="text-gray-600 mb-6">
              Nossa categoria de assinaturas oferece controle completo sobre todos os seus assinantes 
              com dashboard intuitivo e exportação de dados.
            </p>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">Aprovados Assinaturas Ativas</h3>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4">
              <ul className="list-disc pl-6 text-muted-foreground">
                <li>Lista completa de assinantes ativos</li>
                <li>Data da próxima cobrança</li>
                <li>Valor da assinatura</li>
                <li>Período de cobrança</li>
                <li>Status do pagamento</li>
                <li>Dados completos do cliente</li>
                <li>Histórico de transações</li>
                <li>Botão para cancelar assinatura</li>
              </ul>
            </div>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">ATENÇÃO: Vencendo em 3 Dias</h3>
            <div className="bg-emerald-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <ul className="list-disc pl-6 text-muted-foreground">
                <li>Assinaturas próximas do vencimento</li>
                <li>Alertas automáticos por e-mail</li>
                <li>Notificações push para o assinante</li>
                <li>Opção de renovação antecipada</li>
                <li>Desconto de retenção personalizado</li>
                <li>Comunicação proativa</li>
              </ul>
            </div>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">Rejeitados Assinaturas Vencidas</h3>
            <div className="bg-emerald-50 border border-red-200 rounded-lg p-4 mb-4">
              <ul className="list-disc pl-6 text-muted-foreground">
                <li>Assinaturas com pagamento em atraso</li>
                <li>Tentativas automáticas de cobrança</li>
                <li>Período de graça configurável</li>
                <li>Bloqueio automático de acesso</li>
                <li>Comunicação de recuperação</li>
                <li>Opção de reativação</li>
              </ul>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Cards de Dados Completos</h2>
            
            <p className="text-gray-600 mb-4">
              Cada assinante é exibido em um card completo com todas as informações relevantes:
            </p>

            <div className="bg-gray-50 p-6 rounded-lg">
              <h4 className="font-semibold text-gray-800 mb-3">Exemplo de Card do Cliente:</h4>
              <div className="bg-white p-4 rounded border">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h5 className="font-semibold">Joo Silva</h5>
                    <p className="text-sm text-gray-600">joao@email.com</p>
                    <p className="text-sm text-gray-600">(11) 99999-9999</p>
                  </div>
                  <span className="px-2 py-1 bg-emerald-100 text-muted-foreground text-sm rounded">Ativo</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Plano:</span>
                    <span className="font-semibold ml-2">Premium Mensal</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Valor:</span>
                    <span className="font-semibold ml-2">R$ 97,00</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Próxima cobrança:</span>
                    <span className="font-semibold ml-2">15/02/2025</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Cliente desde:</span>
                    <span className="font-semibold ml-2">15/01/2025</span>
                  </div>
                </div>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Exportação de Dados</h2>
            
            <div className="bg-emerald-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3">Dados Relatórios Personalizados</h3>
              <p className="text-muted-foreground mb-4">
                Exporte todos os dados de assinantes para análise avançada ou integração com outras ferramentas.
              </p>
              
              <h4 className="font-semibold text-muted-foreground mb-2">Formatos Disponíveis:</h4>
              <ul className="list-disc pl-6 text-muted-foreground mb-4">
                <li><strong>CSV:</strong> Para planilhas e análises</li>
                <li><strong>Excel:</strong> Com formatação avançada</li>
                <li><strong>PDF:</strong> Relatórios para apresentação</li>
                <li><strong>JSON:</strong> Para integrações técnicas</li>
              </ul>

              <h4 className="font-semibold text-muted-foreground mb-2">Filtros de Exportação:</h4>
              <ul className="list-disc pl-6 text-muted-foreground">
                <li>Por período de data</li>
                <li>Por status da assinatura</li>
                <li>Por valor do plano</li>
                <li>Por método de pagamento</li>
                <li>Por região geográfica</li>
              </ul>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">FuncionalidadesFuncionalidades Avanadas</h2>
            
            <div className="grid md:grid-cols-2 gap-6 mt-6">
              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3"> Renovao Automática</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li>Cobrança automática no vencimento</li>
                  <li>Retry inteligente em caso de falha</li>
                  <li>Notificações personalizadas</li>
                  <li>Atualização automática de cartões</li>
                </ul>
              </div>

              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3"> Gestão de Preos</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li>Planos com preos escalonados</li>
                  <li>Descontos automáticos por fidelidade</li>
                  <li>Cupons de desconto personalizados</li>
                  <li>Preos diferenciados por regio</li>
                </ul>
              </div>

              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3"> Comunicao Automática</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li>Boas-vindas personalizadas</li>
                  <li>Lembretes de pagamento</li>
                  <li>Ofertas de reteno</li>
                  <li>Pesquisas de satisfao</li>
                </ul>
              </div>

              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Analytics Detalhados</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li>MRR (Receita Recorrente Mensal)</li>
                  <li>Taxa de churn por período</li>
                  <li>LTV (Lifetime Value) médio</li>
                  <li>Métricas de reteno</li>
                </ul>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">EstratégiasEstratégias de Sucesso</h2>
            
            <div className="bg-gradient-to-r from-emerald-50 to-blue-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3"> Dicas para Maximizar Assinaturas</h3>
              <ol className="list-decimal pl-6 text-gray-700">
                <li className="mb-2">
                  <strong>Oferea período de teste:</strong> 7-14 dias grtis aumenta conversão
                </li>
                <li className="mb-2">
                  <strong>Desconto anual:</strong> Oferea 2-3 meses grtis no plano anual
                </li>
                <li className="mb-2">
                  <strong>Onboarding eficiente:</strong> Primeiros 30 dias são cruciais
                </li>
                <li className="mb-2">
                  <strong>Conteúdo regular:</strong> Mantenha valor constante para reduzir churn
                </li>
                <li className="mb-2">
                  <strong>Comunicao proativa:</strong> Antecipe problemas e celebre marcos
                </li>
              </ol>
            </div>

            <div className="mt-8 p-6 bg-gradient-to-r from-emerald-50 to-blue-50 rounded-lg">
              <h3 className="font-semibold text-muted-foreground mb-2"> Comece Seu Negócio Recorrente</h3>
              <p className="text-gray-700 mb-4">
                <strong>Transforme sua expertise em receita recorrente.</strong> 
                Configure sua primeira assinatura em menos de 10 minutos.
              </p>
              <a 
                href="/seller/register" 
                className="inline-block bg-gradient-to-r from-emerald-600 to-emerald-700 text-white px-6 py-3 rounded-lg font-semibold hover:from-muted hover:to-muted transition-colors"
              >
                Criar Minha Primeira Assinatura               </a>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Footer */}
      <footer className="bg-gradient-to-br from-black via-gray-900 to-black text-white py-20 border-t border-blue-500/20 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-0 left-0 w-96 h-96 bg-emerald-500 rounded-full blur-3xl animate-pulse-slow"></div>
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-emerald-500 rounded-full blur-3xl animate-pulse-slower"></div>
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 z-10">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-10">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl flex items-center justify-center animate-pulse-slow">
                  <CreditCard className="h-7 w-7 text-white" />
                </div>
                <span className="text-lg font-bold bg-gradient-to-r from-emerald-600 to-emerald-700 bg-clip-text text-transparent">
                  VolatusPay
                </span>
              </div>
              <p className="text-emerald-100 mb-8 text-base leading-relaxed">
                A plataforma de checkout mais completa do Brasil com área de membros integrada. 
                Venda produtos digitais e assinaturas com a máxima conversão.
              </p>
            </div>
            
            <div>
              <h4 className="font-bold text-lg mb-4 text-white">Produtos</h4>
              <ul className="space-y-3 text-emerald-200">
                <li><a href="/products/digital" className="hover:text-muted-foreground transition-colors text-sm">Produtos Digitais</a></li>
                <li><a href="/products/subscriptions" className="hover:text-muted-foreground transition-colors text-sm">Assinaturas</a></li>
                <li><a href="/products/members-area" className="hover:text-muted-foreground transition-colors text-sm">área de Membros</a></li>
                <li><a href="/products/checkout-optimized" className="hover:text-muted-foreground transition-colors text-sm">Checkout Otimizado</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold text-lg mb-4 text-white">Legal</h4>
              <ul className="space-y-3 text-emerald-200">
                <li><a href="/legal/privacy" className="hover:text-muted-foreground transition-colors text-sm">Privacidade</a></li>
                <li><a href="/legal/terms" className="hover:text-muted-foreground transition-colors text-sm">Termos de Uso</a></li>
                <li><a href="/legal/refund" className="hover:text-muted-foreground transition-colors text-sm">Política de Reembolso</a></li>
                <li><a href="/legal/chargeback" className="hover:text-muted-foreground transition-colors text-sm">Chargeback</a></li>
                <li><a href="/legal/compliance" className="hover:text-muted-foreground transition-colors text-sm">Compliance</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold text-lg mb-4 text-white">Suporte</h4>
              <ul className="space-y-3 text-emerald-200">
                <li><a href="#" className="hover:text-muted-foreground transition-colors text-sm">Central de Ajuda</a></li>
                <li><a href="#" className="hover:text-muted-foreground transition-colors text-sm">Documentação</a></li>
                <li><a href="/#taxas" className="hover:text-muted-foreground transition-colors text-sm">Taxas</a></li>
                <li><a href="/#whitelabel" className="hover:text-muted-foreground transition-colors text-sm">Whitelabel</a></li>
                <li><a href="mailto:volatuspay@gmail.com" className="hover:text-muted-foreground transition-colors text-sm">Contato</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-blue-500/20 pt-10">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="text-center md:text-left">
                <p className="text-emerald-200 font-medium text-base leading-relaxed">
                  &copy; 2025 VolatusPay. Todos os direitos reservados.
                </p>
                <p className="text-[#2563eb] text-sm mt-1">
                  Plataforma segura e certificada PCI DSS
                </p>
              </div>
              <div className="text-center md:text-right">
                <p className="text-[#2563eb] text-sm">
                  Desenvolvido por{" "}
                  <a 
                    href="https://www.instagram.com/volatuspay/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-emerald-700 hover:text-[#2563eb] font-semibold transition-colors"
                  >
                    @volatuspay
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <Dialog open={showLogin} onOpenChange={setShowLogin}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Entrar na sua conta</DialogTitle>
            <DialogDescription>Digite suas credenciais para acessar sua conta</DialogDescription>
          </DialogHeader>
          <LoginForm compact onClose={() => setShowLogin(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={showRegisterChoice} onOpenChange={setShowRegisterChoice}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Escolha o tipo de conta</DialogTitle>
            <DialogDescription>Selecione o tipo de conta que deseja criar</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 py-4">
            <Button
              onClick={() => {
                setShowRegisterChoice(false);
                setShowRegisterCustomer(true);
              }}
              variant="outline"
              className="h-16 flex items-center gap-3"
            >
              <UserPlus className="h-6 w-6 text-emerald-700" />
              <div className="text-left">
                <div className="font-medium">Criar Conta para Acessar Produtos</div>
                <div className="text-sm text-gray-500">Para clientes que querem comprar</div>
              </div>
            </Button>
            <Link href="/seller/register">
              <Button
                onClick={() => setShowRegisterChoice(false)}
                variant="outline"
                className="h-16 flex items-center gap-3 w-full"
              >
                <Store className="h-6 w-6 text-emerald-700" />
                <div className="text-left">
                  <div className="font-medium">Criar Conta Vendedor</div>
                  <div className="text-sm text-gray-500">Para quem quer vender produtos</div>
                </div>
              </Button>
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRegisterCustomer} onOpenChange={setShowRegisterCustomer}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar Conta Cliente</DialogTitle>
            <DialogDescription>Crie sua conta para acessar produtos</DialogDescription>
          </DialogHeader>
          <RegisterForm 
            type="buyer" 
            compact 
            onClose={() => setShowRegisterCustomer(false)} 
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}