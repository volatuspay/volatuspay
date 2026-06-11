import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { Building2, CreditCard, UserPlus, Store } from "lucide-react";

export default function DigitalProducts() {
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
            
            {/* Navegao Central */}
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
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Produtos Digitais</h1>
          
          <div className="prose prose-gray max-w-none">
            <p className="text-lg text-gray-600 mb-8">
              Venda seus produtos digitais com a máxima conversão e área de membros integrada. 
              Nossa plataforma é especializada em infoprodutos e conteúdo educacional.
            </p>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Aprovados Produtos Digitais Permitidos</h2>
            
            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3"> Educacionais</h3>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>E-books:</strong> Livros digitais, guias, manuais educativos</li>
              <li><strong>Cursos Online:</strong> Video-aulas, treinamentos, certificações</li>
              <li><strong>Mentorias:</strong> Acompanhamento personalizado, coaching</li>
              <li><strong>Workshops:</strong> Eventos online, masterclasses</li>
              <li><strong>Templates:</strong> Planilhas, apresentaes, modelos</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">Tecnolgicos</h3>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>Softwares:</strong> Aplicativos, ferramentas digitais</li>
              <li><strong>Plugins:</strong> Extenses, complementos</li>
              <li><strong>Códigos:</strong> Scripts, temas, templates de código</li>
              <li><strong>Apps Mobile:</strong> Aplicativos para smartphone</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">Criativos</h3>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>Design:</strong> Logotipos, identidades visuais</li>
              <li><strong>Msica:</strong> Beats, trilhas sonoras, udios</li>
              <li><strong>Vdeos:</strong> Conteúdo educativo, tutoriais</li>
              <li><strong>Fotografias:</strong> Banco de imagens, presets</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">Profissionais</h3>
            <ul className="list-disc pl-6 mb-4">
              <li><strong>Consultorias:</strong> Relatrios, análises especializadas</li>
              <li><strong>Planejamentos:</strong> Estratégias, roadmaps</li>
              <li><strong>Auditorias:</strong> Avaliaes técnicas</li>
              <li><strong>Assessorias:</strong> Suporte especializado</li>
            </ul>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Rejeitados Produtos Digitais NÃO Permitidos</h2>
            
            <div className="bg-emerald-50 border border-red-200 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3">Conteúdo Adulto</h3>
              <ul className="list-disc pl-6 text-muted-foreground">
                <li>Conteúdo pornográfico ou sexual</li>
                <li>Materiais eróticos digitais</li>
                <li>Cursos ou e-books sobre sexualidade</li>
                <li>Conteúdo para maiores de 18 anos</li>
              </ul>
            </div>

            <div className="bg-emerald-50 border border-red-200 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3">Bloqueios Atividades Ilegais</h3>
              <ul className="list-disc pl-6 text-muted-foreground">
                <li>Softwares pirateados ou crackeados</li>
                <li>Conteúdo com direitos autorais violados</li>
                <li>Manuais para atividades ilegais</li>
                <li>Documentos falsificados ou fraudulentos</li>
              </ul>
            </div>

            <div className="bg-emerald-50 border border-red-200 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3">Jogos e Apostas</h3>
              <ul className="list-disc pl-6 text-muted-foreground">
                <li>Softwares de apostas ou cassino</li>
                <li>Sistemas de jogos de azar</li>
                <li>Bots para apostas esportivas</li>
                <li>Cursos sobre jogos de azar</li>
              </ul>
            </div>

            <div className="bg-emerald-50 border border-red-200 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3"> Esquemas Financeiros</h3>
              <ul className="list-disc pl-6 text-muted-foreground">
                <li>Métodos de pirmide financeira</li>
                <li>Esquemas Ponzi digitais</li>
                <li>Investimentos no regulamentados</li>
                <li>Promessas de enriquecimento fcil</li>
              </ul>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4"> Vantagens da Nossa Plataforma</h2>
            
            <div className="grid md:grid-cols-2 gap-6 mt-6">
              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3"> área de Membros Automática</h3>
                <p className="text-muted-foreground">
                  Cada checkout gera automaticamente uma área de membros exclusiva com módulos, 
                  aulas e controle de acesso.
                </p>
              </div>

              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Dados Analytics Avanados</h3>
                <p className="text-muted-foreground">
                  Acompanhe vendas, conversões, engajamento e progresso dos alunos 
                  em tempo real.
                </p>
              </div>

              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Cartão Pagamentos Otimizados</h3>
                <p className="text-muted-foreground">
                  PIX, cartão de crédito e pagamentos internacionais com as menores taxas 
                  do mercado.
                </p>
              </div>

              <div className="bg-emerald-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-muted-foreground mb-3">Proteção Anti-Pirataria</h3>
                <p className="text-muted-foreground">
                  Sistema avanado de proteção contra downloads não autorizados 
                  e compartilhamento ilegal.
                </p>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Cases de Sucesso</h2>
            
            <div className="bg-gray-50 p-6 rounded-lg">
              <p className="text-gray-700 mb-4">
                <strong>Nossos criadores jvenderam mais de R$ 10 milhes</strong> em produtos digitais usando nossa plataforma:
              </p>
              <ul className="list-disc pl-6 text-gray-700">
                <li>Cursos online com mais de 95% de satisfao</li>
                <li>E-books com taxas de conversão superiores a 8%</li>
                <li>Mentorias com recorrncia média de 6 meses</li>
                <li>Softwares com ndice de refund inferior a 2%</li>
              </ul>
            </div>

            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4"> Como Comear</h2>
            
            <ol className="list-decimal pl-6 mb-6">
              <li className="mb-3">
                <strong>Cadastre-se:</strong> Crie sua conta gratuita em menos de 2 minutos
              </li>
              <li className="mb-3">
                <strong>Configure seu produto:</strong> Adicione ttulo, descrição, preo e arquivos
              </li>
              <li className="mb-3">
                <strong>Personalize o checkout:</strong> Escolha cores, textos e otimizaes
              </li>
              <li className="mb-3">
                <strong>Configure a área de membros:</strong> Organize módulos e aulas
              </li>
              <li className="mb-3">
                <strong>Publique e venda:</strong> Compartilhe seu link e comece a vender
              </li>
            </ol>

            <div className="mt-8 p-6 bg-gradient-to-r from-emerald-50 to-blue-50 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Oferta Especial</h3>
              <p className="text-gray-700 mb-4">
                <strong>Primeiros 30 dias GRTIS</strong> para novos criadores de produtos digitais. 
                Sem taxa de setup, sem mensalidade.
              </p>
              <a 
                href="/seller/register" 
                className="inline-block bg-emerald-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-emerald-500 transition-colors"
              >
                Comear Agora               </a>
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