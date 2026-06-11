import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { Building2, CreditCard, UserPlus, Store } from "lucide-react";

export default function MembersArea() {
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
          <h1 className="text-3xl font-bold text-gray-900 mb-8">área de Membros Integrada</h1>
          
          <div className="prose prose-gray max-w-none">
            <p className="text-lg text-gray-600 mb-8">
              Cada checkout que voccriar automaticamente gera uma área de membros exclusiva e completa. 
              Seus clientes tero acesso imediato a todo o conteúdo após a aprovação do pagamento.
            </p>

            <div className="bg-gradient-to-r from-emerald-50 to-blue-50 p-6 rounded-lg mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4"> Criao Automática</h2>
              <p className="text-gray-700 mb-4">
                <strong>100% Automático:</strong> Ao criar qualquer checkout (produto digital ou assinatura), 
                nossa plataforma automaticamente gera uma área de membros personalizada.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-lg">
                  <h3 className="font-semibold text-muted-foreground mb-2">Aprovados VocCria o Checkout</h3>
                  <p className="text-sm text-gray-600">Define produto, preo e configurações</p>
                </div>
                <div className="bg-white p-4 rounded-lg">
                  <h3 className="font-semibold text-muted-foreground mb-2"> área de Membros Pronta</h3>
                  <p className="text-sm text-gray-600">Sistema gera automaticamente a área completa</p>
                </div>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Acesso Direto via Link</h2>
            
            <div className="bg-emerald-50 border border-blue-200 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3">Acesso Imediato</h3>
              <p className="text-muted-foreground mb-4">
                Assim que o pagamento é aprovado, o cliente recebe automaticamente:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground">
                <li>Link direto para área de membros</li>
                <li>Credenciais de login (e-mail + senha)</li>
                <li>E-mail de boas-vindas personalizado</li>
                <li>Acesso liberado instantaneamente</li>
                <li>Compatvel com todos os dispositivos</li>
              </ul>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Personalizao Completa</h2>
            
            <p className="text-gray-600 mb-6">
              Personalize completamente sua área de membros sem conhecimento técnico. 
              Interface amigvel e intuitiva para criadores de conteúdo.
            </p>

            <div className="grid md:grid-cols-2 gap-6 mt-6">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Personalizao Visual</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li><strong>Ttulo Personalizado:</strong> Nome do curso/produto</li>
                  <li><strong>Logo e Branding:</strong> Sua marca em destaque</li>
                  <li><strong>Cores Customizadas:</strong> Paleta da sua marca</li>
                  <li><strong>Descrição Principal:</strong> Apresentao do conteúdo</li>
                  <li><strong>Imagem de Capa:</strong> Visual atrativo</li>
                  <li><strong>Favicon Personalizado:</strong> ícone nico</li>
                </ul>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Organizao de Conteúdo</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li><strong>Módulos Estruturados:</strong> Organize por temas</li>
                  <li><strong>Aulas Sequenciais:</strong> Aprendizado progressivo</li>
                  <li><strong>Anexos e Recursos:</strong> PDFs, planilhas, links</li>
                  <li><strong>Vdeos HD:</strong> Player integrado</li>
                  <li><strong>udios e Podcasts:</strong> Conteúdo diversificado</li>
                  <li><strong>Exerccios e Quizzes:</strong> Interatividade</li>
                </ul>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4"> Sistema de Módulos e Aulas</h2>
            
            <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4"> Estrutura Hierrquica</h3>
              
              <div className="bg-gray-50 p-4 rounded-lg mb-4">
                <h4 className="font-semibold text-gray-700 mb-2">Exemplo de Estrutura:</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <div className="pl-0"><strong>Módulo 1:</strong> Fundamentos</div>
                  <div className="pl-4">Aula 1.1: Introdução</div>
                  <div className="pl-4">Aula 1.2: Conceitos Bsicos</div>
                  <div className="pl-4">Aula 1.3: Exerccio Prtico</div>
                  <div className="pl-0 mt-2"><strong>Módulo 2:</strong> Intermedirio</div>
                  <div className="pl-4">Aula 2.1: Técnicas Avanadas</div>
                  <div className="pl-4">Aula 2.2: Estudos de Caso</div>
                </div>
              </div>

              <h4 className="font-semibold text-gray-700 mb-2"> Funcionalidades por Aula:</h4>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-emerald-50 p-3 rounded">
                  <h5 className="font-semibold text-muted-foreground text-sm mb-1">Vdeos</h5>
                  <p className="text-xs text-muted-foreground">Player HD com controles avanados</p>
                </div>
                <div className="bg-emerald-50 p-3 rounded">
                  <h5 className="font-semibold text-muted-foreground text-sm mb-1">Texto</h5>
                  <p className="text-xs text-muted-foreground">Conteúdo escrito formatado</p>
                </div>
                <div className="bg-emerald-50 p-3 rounded">
                  <h5 className="font-semibold text-muted-foreground text-sm mb-1">Anexos</h5>
                  <p className="text-xs text-muted-foreground">Downloads de materiais</p>
                </div>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4"> Totalmente Gratuito</h2>
            
            <div className="bg-gradient-to-r from-emerald-50 to-emerald-50 border border-emerald-200 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3">Includo no Seu Plano</h3>
              <p className="text-muted-foreground mb-4">
                <strong>Zero custos adicionais!</strong> A área de membros completa estincluda em qualquer checkout que voccriar.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-semibold text-muted-foreground mb-2">Aprovados Sem Limites</h4>
                  <ul className="list-disc pl-6 text-muted-foreground text-sm">
                    <li>Módulos ilimitados</li>
                    <li>Aulas ilimitadas</li>
                    <li>Upload de vdeos sem restrio</li>
                    <li>Alunos ilimitados</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-muted-foreground mb-2">Aprovados Recursos Premium</h4>
                  <ul className="list-disc pl-6 text-muted-foreground text-sm">
                    <li>Player de vdeo profissional</li>
                    <li>Sistema de progresso</li>
                    <li>Certificados automáticos</li>
                    <li>Suporte técnico incluso</li>
                  </ul>
                </div>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4"> Funcionalidades Avanadas</h2>
            
            <div className="grid md:grid-cols-2 gap-6 mt-6">
              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Dados Acompanhamento de Progresso</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li>Barra de progresso por módulo</li>
                  <li>Porcentagem de concluso</li>
                  <li>Aulas assistidas vs pendentes</li>
                  <li>Tempo total de estudo</li>
                  <li>Histórico de atividades</li>
                </ul>
              </div>

              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Gamificao</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li>Certificados de concluso</li>
                  <li>Badges de premiações</li>
                  <li>Sistema de pontuao</li>
                  <li>Ranking de alunos</li>
                  <li>Metas personalizadas</li>
                </ul>
              </div>

              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Interatividade</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li>Comentrios por aula</li>
                  <li>Frum de discusso</li>
                  <li>Perguntas e respostas</li>
                  <li>Chat direto com instrutor</li>
                  <li>Avaliaes e feedback</li>
                </ul>
              </div>

              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Segurana e Controle</h3>
                <ul className="list-disc pl-6 text-muted-foreground">
                  <li>Acesso controlado por pagamento</li>
                  <li>Proteção contra pirataria</li>
                  <li>Watermark em vdeos</li>
                  <li>Controle de downloads</li>
                  <li>Expirao de acesso (opcional)</li>
                </ul>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Experincia Mobile</h2>
            
            <div className="bg-gradient-to-r from-blue-50 to-emerald-50 p-6 rounded-lg mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Totalmente Responsivo</h3>
              <p className="text-gray-700 mb-4">
                Sua área de membros funciona perfeitamente em qualquer dispositivo, 
                oferecendo a melhor experincia para seus alunos.
              </p>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-lg text-center">
                  <div className="text-2xl mb-2"></div>
                  <h4 className="font-semibold text-gray-700">Mobile</h4>
                  <p className="text-sm text-gray-600">Interface otimizada para celular</p>
                </div>
                <div className="bg-white p-4 rounded-lg text-center">
                  <div className="text-2xl mb-2"></div>
                  <h4 className="font-semibold text-gray-700">Tablet</h4>
                  <p className="text-sm text-gray-600">Experincia adaptada para tablets</p>
                </div>
                <div className="bg-white p-4 rounded-lg text-center">
                  <div className="text-2xl mb-2"></div>
                  <h4 className="font-semibold text-gray-700">Desktop</h4>
                  <p className="text-sm text-gray-600">Interface completa para computador</p>
                </div>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Analytics da área de Membros</h2>
            
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Dados Métricas Detalhadas</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-semibold text-gray-700 mb-2">Engajamento de Alunos</h4>
                  <ul className="list-disc pl-6 text-gray-600 text-sm">
                    <li>Taxa de concluso por módulo</li>
                    <li>Tempo médio de estudo</li>
                    <li>Aulas mais assistidas</li>
                    <li>Pontos de abandono</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-700 mb-2">Performance do Conteúdo</h4>
                  <ul className="list-disc pl-6 text-gray-600 text-sm">
                    <li>Avaliaes por aula</li>
                    <li>Comentrios mais frequentes</li>
                    <li>Downloads de materiais</li>
                    <li>Satisfao geral</li>
                  </ul>
                </div>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4"> Cases de Sucesso</h2>
            
            <div className="bg-gradient-to-r from-emerald-50 to-blue-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Resultados Reais</h3>
              <div className="grid md:grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-muted-foreground">150k+</div>
                  <div className="text-sm text-gray-600">Alunos ativos na plataforma</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-muted-foreground">94%</div>
                  <div className="text-sm text-gray-600">Taxa média de concluso</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-muted-foreground">4.8/5</div>
                  <div className="text-sm text-gray-600">Avaliao média dos cursos</div>
                </div>
              </div>
            </div>

            <div className="mt-8 p-6 bg-gradient-to-r from-emerald-50 to-pink-50 rounded-lg">
              <h3 className="font-semibold text-muted-foreground mb-2"> Crie Sua área de Membros</h3>
              <p className="text-gray-700 mb-4">
                <strong>Transforme seu conhecimento em um curso profissional.</strong> 
                área de membros completa criada automaticamente com seu primeiro checkout.
              </p>
              <a 
                href="/seller/register" 
                className="inline-block bg-gradient-to-r from-emerald-600 to-emerald-700 text-white px-6 py-3 rounded-lg font-semibold hover:from-muted hover:to-muted transition-colors"
              >
                Criar Minha Primeira área de Membros               </a>
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