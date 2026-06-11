import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Users, FileText, Settings, Zap, Apple, Play, Phone, ArrowRight, Shield, Globe, CreditCard, BarChart3 } from "lucide-react";
import { Link } from "wouter";
export default function WhitelabelPage() {
  const handleWhatsAppContact = () => {
    window.open('https://api.whatsapp.com/send?phone=5515998000086&text=Ol%C3%A1%21%20Gostaria%20de%20ativar%20meu%20gateway%20whitelabel.', '_blank');
  };

  const features = [
    {
      icon: Users,
      title: "Área de Membros",
      description: "Dashboard completo para gerenciar clientes, sellers e operações"
    },
    {
      icon: CreditCard,
      title: "Checkout Produto",
      description: "Sistema de pagamento integrado com PIX, cartão e boleto"
    },
    {
      icon: FileText,
      title: "Sistema de Tickets",
      description: "Suporte automatizado com gestão de demandas centralizada"
    },
    {
      icon: Settings,
      title: "Cargos e Equipe",
      description: "Controle de permissões, roles e organização interna"
    },
    {
      icon: BarChart3,
      title: "Analytics & Relatórios",
      description: "Dashboard com métricas em tempo real e exportação de dados"
    },
    {
      icon: Globe,
      title: "Multi-Moeda",
      description: "Suporte para transações em BRL e moedas internacionais"
    }
  ];

  const integrations = [
    "PIX em tempo real",
    "Cartão de crédito (nacional e internacional)",
    "Boleto bancário",
    "Apple Pay e Google Pay",
    "Webhooks em tempo real",
    "API completa"
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-emerald-900 to-black">
      {/* Header */}
      <div className="border-b border-emerald-500/20 bg-black/40 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/">
            <a className="h-12 flex items-center">
              <img src="/favicon.png?v=2" alt="VolatusPay" style={{ height: "34px", width: "34px", objectFit: "contain" }} />
            </a>
          </Link>
          <div className="flex gap-3">
            <Link href="/">
              <a className="text-gray-400 hover:text-white transition-colors text-sm px-4 py-2 rounded hover:bg-white/10">
                Voltar
              </a>
            </Link>
            <Button 
              onClick={handleWhatsAppContact}
              size="sm"
              className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 text-white"
              data-testid="button-whatsapp-contact"
            >
              <Phone className="h-4 w-4 mr-2" />
              WhatsApp
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-16 md:py-24">
        {/* Hero Section */}
        <div className="text-center mb-20">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black mb-4 text-white leading-tight">
            Ative seu Gateway em 1 Hora
          </h1>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto mb-8">
            <div className="bg-white/10 border border-emerald-500/30 rounded-lg p-3">
              <p className="text-cyan-400 font-semibold text-sm sm:text-base">Sua Logo</p>
              <p className="text-gray-300 text-xs sm:text-sm">Branding completo</p>
            </div>
            <div className="bg-white/10 border border-emerald-500/30 rounded-lg p-3">
              <p className="text-cyan-400 font-semibold text-sm sm:text-base">Paleta de Cor</p>
              <p className="text-gray-300 text-xs sm:text-sm">Identidade visual</p>
            </div>
            <div className="bg-white/10 border border-emerald-500/30 rounded-lg p-3">
              <p className="text-cyan-400 font-semibold text-sm sm:text-base">Seu Domínio</p>
              <p className="text-gray-300 text-xs sm:text-sm">URL personalizada</p>
            </div>
          </div>
          <p className="text-lg sm:text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed px-4 mb-6">
            Plataforma de pagamentos enterprise-grade com sua marca. <strong className="text-emerald-400">Venda no Brasil</strong> e <strong className="text-cyan-400">globalmente</strong>. Integração zero-cost com múltiplos adquirentes.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mb-16">
          {features.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <Card key={idx} className="bg-white/5 border-emerald-500/30 backdrop-blur-sm hover:border-cyan-500/50 transition-all hover:bg-white/8">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4 mb-3">
                    <Icon className="h-8 w-8 text-white flex-shrink-0" />
                  </div>
                  <h3 className="text-white font-semibold mb-2">{feature.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Integrações */}
        <Card className="bg-white/5 border-emerald-500/30 backdrop-blur-sm mb-16">
          <CardHeader>
            <CardTitle className="text-white text-2xl">Meios de Pagamento Integrados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              {integrations.map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full"></div>
                  <span className="text-gray-300">{item}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Demo Access Block */}
        <Card className="border shadow-lg bg-gradient-to-br from-cyan-600/30 to-emerald-600/30 backdrop-blur-xl border-cyan-500/50 mb-16">
          <CardContent className="p-8">
            <div className="space-y-6">
              <div>
                <p className="text-white text-lg font-bold mb-2">Teste Gratuitamente</p>
                <p className="text-gray-300 text-sm">
                  Conheça o fluxo completo e navegue no melhor e mais avançado gateway whitelabel do mercado:
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-black/40 rounded-lg p-6 border border-white/10">
                <div>
                  <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold mb-2">Site</p>
                  <p className="text-white font-mono text-sm">volatuspay.com/login</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold mb-2">Login</p>
                  <p className="text-white font-mono text-sm">zenpagamentosbr@gmail.com</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs uppercase tracking-wider font-semibold mb-2">Senha</p>
                  <p className="text-white font-mono text-sm">zxcasdqwe</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pricing Cards */}
        <div className="mb-16">
          <h2 className="text-3xl font-bold text-white text-center mb-12">Planos de Investimento</h2>
          <div className="grid md:grid-cols-2 gap-8">
            {/* Plano 1: À Vista */}
            <Card className="bg-gradient-to-br from-emerald-600/25 to-emerald-600/5 border-emerald-500/50 backdrop-blur-sm hover:shadow-2xl transition-all">
              <CardHeader>
                <CardTitle className="text-white text-2xl mb-2">Setup Único</CardTitle>
                <p className="text-gray-300 text-sm">Investimento único e ativação imediata</p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 border border-emerald-500/30 rounded-lg p-6">
                  <p className="text-gray-400 text-sm mb-2">Investimento Inicial</p>
                  <p className="text-4xl font-black text-white mb-2">R$ 10.000</p>
                  <p className="text-cyan-400 text-sm font-semibold">Pagamento único</p>
                </div>

                <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-5 space-y-3">
                  <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Taxas Recorrentes</p>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-sm">1% TPV</span>
                    <span className="text-white font-bold">sobre transações</span>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-gray-700/30">
                    <span className="text-gray-300 text-sm">Manutenção</span>
                    <span className="text-cyan-400 font-bold">R$ 197,90/mês</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-cyan-400" />
                    <span className="text-gray-300 text-sm">Ativação garantida em 1 hora</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-cyan-400" />
                    <span className="text-gray-300 text-sm">Suporte 24/7 dedicado</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-cyan-400" />
                    <span className="text-gray-300 text-sm">Dashboard analytics premium</span>
                  </div>
                </div>

                <Button 
                  onClick={handleWhatsAppContact}
                  className="w-full bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 text-white h-12 text-base font-semibold"
                  data-testid="button-pricing-vista"
                >
                  Solicitar Demonstração
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </CardContent>
            </Card>

            {/* Plano 2: Parcelado */}
            <Card className="bg-gradient-to-br from-cyan-600/25 to-cyan-600/5 border-cyan-500/50 backdrop-blur-sm hover:shadow-2xl transition-all md:scale-105 md:origin-center">
              <CardHeader>
                <div className="flex items-center gap-2 mb-2">
                  <CardTitle className="text-white text-2xl">Plano Flexível</CardTitle>
                  <span className="text-xs bg-cyan-500/30 text-cyan-300 px-2 py-1 rounded-full font-semibold">Popular</span>
                </div>
                <p className="text-gray-300 text-sm">Entrada reduzida + parcelamento</p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="bg-gradient-to-r from-cyan-500/20 to-cyan-600/20 border border-cyan-500/30 rounded-lg p-6">
                  <p className="text-gray-400 text-sm mb-2">Entrada</p>
                  <p className="text-3xl font-black text-white mb-4">R$ 5.000</p>
                  
                  <div className="space-y-2 pb-4 border-b border-cyan-500/20">
                    <p className="text-gray-400 text-xs">+ 2 parcelas de</p>
                    <p className="text-2xl font-bold text-cyan-400">R$ 5.000</p>
                  </div>

                  <p className="text-gray-300 text-xs pt-4">
                    <span className="font-semibold text-white">Total: R$ 15.000</span>
                  </p>
                </div>

                <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg p-5 space-y-3">
                  <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Mesmas Taxas</p>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 text-sm">1% TPV</span>
                    <span className="text-white font-bold">sobre transações</span>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-gray-700/30">
                    <span className="text-gray-300 text-sm">Manutenção</span>
                    <span className="text-cyan-400 font-bold">R$ 197,90/mês</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-cyan-400" />
                    <span className="text-gray-300 text-sm">Parcelamento flexível</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-cyan-400" />
                    <span className="text-gray-300 text-sm">Mesma ativação rápida</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-cyan-400" />
                    <span className="text-gray-300 text-sm">Recursos premium inclusos</span>
                  </div>
                </div>

                <Button 
                  onClick={handleWhatsAppContact}
                  className="w-full bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-700 hover:to-emerald-700 text-white h-12 text-base font-semibold"
                  data-testid="button-pricing-parcelado"
                >
                  Solicitar Proposta
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Suporte VIP */}
        <Card className="bg-gradient-to-r from-emerald-600/40 to-cyan-600/40 border border-emerald-500/50 backdrop-blur-sm mb-16">
          <CardContent className="p-8 md:p-12">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
              <div>
                <h3 className="text-3xl font-bold text-white mb-4">Contrato + Suporte VIP</h3>
                <p className="text-gray-300 mb-6 leading-relaxed">
                  Todos os planos incluem <strong className="text-cyan-400">contrato profissional</strong>, acesso a <strong className="text-cyan-400">grupo VIP privado de suporte</strong> e manutenção dedicada pelo WhatsApp. Seu crescimento é nossa responsabilidade.
                </p>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-300"><strong className="text-white">Contrato profissional</strong> e formalizado</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-300"><strong className="text-white">Grupo VIP privado</strong> no WhatsApp com sua equipe</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-300"><strong className="text-white">Manutenção 24/7</strong> dedicada e suporte prioritário</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-300"><strong className="text-white">Roadmap personalizado</strong> com suas necessidades</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-300"><strong className="text-white">Updates e melhorias</strong> exclusivas para seu gateway</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col justify-center items-center gap-6">
                <div className="w-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 rounded-xl p-8">
                  <div className="text-center">
                    <Phone className="h-16 w-16 text-cyan-400 mx-auto mb-4" />
                    <h4 className="text-white font-bold text-xl mb-2">Suporte via WhatsApp</h4>
                    <p className="text-gray-300 text-sm mb-4">Comunicação direta e rápida com nossa equipe técnica</p>
                    <Button 
                      onClick={handleWhatsAppContact}
                      className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white"
                      data-testid="button-whatsapp-support"
                    >
                      <Phone className="h-4 w-4 mr-2" />
                      Atendimento Imediato
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Apps Nativos */}
        <Card className="bg-gradient-to-r from-emerald-600/40 to-cyan-600/40 border-emerald-500/50 backdrop-blur-sm mb-16">
          <CardContent className="p-8 md:p-12">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
              <div>
                <h3 className="text-3xl font-bold text-white mb-4">Apps Nativos iOS & Android</h3>
                <p className="text-gray-300 mb-6 leading-relaxed">
                  Seus clientes acessam via aplicativos nativos já publicados nas lojas oficiais. <strong className="text-cyan-400">Sem custos adicionais de publicação</strong> e <strong className="text-cyan-400">sem comissões extras</strong> sobre transações.
                </p>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-300"><strong className="text-white">Zero custos</strong> de publicação e manutenção</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-300"><strong className="text-white">Sem comissão</strong> adicional sobre vendas</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-300"><strong className="text-white">Push notifications</strong> para clientes</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-300"><strong className="text-white">Offline mode</strong> com sincronização automática</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col justify-center items-center gap-8">
                <div className="grid grid-cols-2 gap-6 w-full">
                  <div className="flex flex-col items-center justify-center p-8 bg-black/40 rounded-xl border border-white/10 hover:border-cyan-500/50 transition-all">
                    <Apple className="h-16 w-16 text-white mb-3" />
                    <p className="text-white font-semibold text-center">App Store</p>
                    <p className="text-gray-400 text-xs text-center mt-1">iPhone & iPad</p>
                  </div>
                  
                  <div className="flex flex-col items-center justify-center p-8 bg-black/40 rounded-xl border border-white/10 hover:border-cyan-500/50 transition-all">
                    <Play className="h-16 w-16 text-cyan-400 mb-3" />
                    <p className="text-white font-semibold text-center">Google Play</p>
                    <p className="text-gray-400 text-xs text-center mt-1">Android</p>
                  </div>
                </div>
                <p className="text-gray-400 text-sm text-center max-w-sm">
                  Clientes acessam de qualquer dispositivo com experiência otimizada
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Segurança */}
        <Card className="bg-white/5 border-emerald-500/30 backdrop-blur-sm mb-16">
          <CardContent className="p-8 md:p-12">
            <div className="flex items-start gap-6">
              <Shield className="h-10 w-10 text-cyan-400 flex-shrink-0" />
              <div>
                <h3 className="text-2xl font-bold text-white mb-3">Segurança Enterprise-Grade</h3>
                <p className="text-gray-300 mb-4">6 camadas de proteção: Criptografia AES-256-GCM, Firebase Auth, Rate Limiting, Webhooks blindados, Validação em tempo real, Compliance com regulamentações brasileiras e LGPD.</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-cyan-400 flex-shrink-0" />
                    <span className="text-gray-300 text-sm">PCI-DSS Compliant</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-cyan-400 flex-shrink-0" />
                    <span className="text-gray-300 text-sm">SSL/TLS 256-bit</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-cyan-400 flex-shrink-0" />
                    <span className="text-gray-300 text-sm">LGPD Compliant</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-cyan-400 flex-shrink-0" />
                    <span className="text-gray-300 text-sm">Backup automático 24/7</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CTA Final */}
        <Card className="bg-gradient-to-r from-emerald-600/40 to-cyan-600/40 border-emerald-500/50 backdrop-blur-sm">
          <CardContent className="p-8 sm:p-12 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">Pronto para transformar seus pagamentos?</h2>
            <p className="text-gray-300 mb-8 text-sm sm:text-base max-w-2xl mx-auto">Ative seu gateway em 1 hora com sua marca, paleta de cores e domínio personalizado.</p>
            <Button 
              onClick={handleWhatsAppContact}
              className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 text-white px-8 py-6 text-base font-semibold inline-flex items-center gap-2"
              data-testid="button-final-cta"
            >
              Iniciar Conversa via WhatsApp
              <Phone className="h-5 w-5" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
