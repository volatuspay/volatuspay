import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Shield, TrendingUp, Users, Briefcase, CheckCircle, Phone } from "lucide-react";
import { Link } from "wouter";

export default function SejaSocio() {
  const handleWhatsAppContact = () => {
    window.open('https://api.whatsapp.com/send?phone=5515998000086&text=Ol%C3%A1%21%20Tenho%20interesse%20em%20conhecer%20a%20oportunidade%20de%20sociedade%20na%20VolatusPay.', '_blank');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-emerald-900 to-black">
      {/* Header */}
      <div className="border-b border-emerald-500/20 bg-black/40 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/">
            <a className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-pink-400 bg-clip-text text-transparent">
              VolatusPay
            </a>
          </Link>
          <Link href="/">
            <a className="text-gray-400 hover:text-white transition-colors text-sm">
              Voltar
            </a>
          </Link>
        </div>
      </div>

      {/* Hero Section */}
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <Badge className="mb-4 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            Oportunidade Exclusiva
          </Badge>
          <h1 className="text-5xl md:text-6xl font-black mb-6 bg-gradient-to-r from-white via-emerald-200 to-pink-200 bg-clip-text text-transparent">
            Seja Scio da VolatusPay
          </h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
            Oportunidade para profissionais com expertise em <span className="text-[#2563eb] font-semibold">pagamentos</span>, <span className="text-[#2563eb] font-semibold">compliance</span> e <span className="text-[#2563eb] font-semibold">fintech</span> que desejam unir foras e ajudar a construir o futuro dos pagamentos no Brasil.
          </p>
        </div>

        {/* Requisitos */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <Card className="bg-white/5 border-emerald-500/20 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Briefcase className="h-6 w-6 text-[#2563eb]" />
                Perfil Ideal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-[#2563eb] mt-0.5 flex-shrink-0" />
                <p className="text-gray-300 text-sm">Experincia comprovada em <strong className="text-white">setor financeiro</strong></p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-[#2563eb] mt-0.5 flex-shrink-0" />
                <p className="text-gray-300 text-sm">Conhecimento em <strong className="text-white">Compliance e KYC</strong></p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-[#2563eb] mt-0.5 flex-shrink-0" />
                <p className="text-gray-300 text-sm">Expertise em <strong className="text-white">meios de pagamento</strong> (PIX, cartões, boleto)</p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-[#2563eb] mt-0.5 flex-shrink-0" />
                <p className="text-gray-300 text-sm">Habilidades em <strong className="text-white">marketing digital</strong></p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-[#2563eb] mt-0.5 flex-shrink-0" />
                <p className="text-gray-300 text-sm">Experincia com <strong className="text-white">gerenciamento de afiliados</strong></p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-yellow-500/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <TrendingUp className="h-6 w-6 text-yellow-400" />
                Oportunidade
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 rounded-lg p-4">
                <p className="text-yellow-400 font-bold text-2xl mb-2">Investimento Inicial</p>
                <p className="text-white text-3xl font-black">A partir de R$ 20.000</p>
                <p className="text-gray-400 text-sm mt-2">Aquisição de percentual societrio</p>
              </div>
              <div className="flex items-center gap-2 text-gray-300 text-sm">
                <Shield className="h-5 w-5 text-[#2563eb]" />
                <span>Participao nos lucros e decises estratégicas</span>
              </div>
              <div className="flex items-center gap-2 text-gray-300 text-sm">
                <Users className="h-5 w-5 text-[#2563eb]" />
                <span>Acesso base de sellers e afiliados</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Como Funciona */}
        <Card className="bg-white/5 border-emerald-500/20 backdrop-blur-sm mb-12">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Building2 className="h-6 w-6 text-[#2563eb]" />
              reas de Atuao do Scio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center p-4">
                <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Shield className="h-8 w-8 text-[#2563eb]" />
                </div>
                <h3 className="text-white font-semibold mb-2">Compliance & KYC</h3>
                <p className="text-gray-400 text-sm">Gestão de processos regulatrios e prevenção fraudes</p>
              </div>
              <div className="text-center p-4">
                <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <TrendingUp className="h-8 w-8 text-blue-400" />
                </div>
                <h3 className="text-white font-semibold mb-2">Marketing & Growth</h3>
                <p className="text-gray-400 text-sm">Estratégias de aquisição e reteno de sellers</p>
              </div>
              <div className="text-center p-4">
                <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Users className="h-8 w-8 text-[#2563eb]" />
                </div>
                <h3 className="text-white font-semibold mb-2">Programa de Afiliados</h3>
                <p className="text-gray-400 text-sm">Expanso e gestão da rede de afiliados</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CTA */}
        <Card className="bg-gradient-to-r from-emerald-600/20 to-pink-600/20 border-emerald-500/30 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <h2 className="text-3xl font-bold text-white mb-4">
              Interesse Real? Entre em Contato
            </h2>
            <p className="text-gray-300 mb-6 max-w-2xl mx-auto">
              Esta é uma oportunidade exclusiva para profissionais sérios que entendem o mercado de pagamentos e querem fazer parte do crescimento da VolatusPay.
            </p>
            <Button 
              onClick={handleWhatsAppContact}
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-lg px-8 py-6 rounded-lg shadow-lg hover:shadow-xl transition-all"
              data-testid="button-whatsapp-contact"
            >
              <Phone className="h-5 w-5 mr-2" />
              WhatsApp: (15) 99687-5001
            </Button>
            <p className="text-gray-400 text-sm mt-4">
              Apenas contato para candidatos com perfil adequado e real interesse
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Footer Simples */}
      <div className="border-t border-emerald-500/20 bg-black/40 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center">
          <p className="text-gray-400 text-sm">
            © 2025 VolatusPay. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </div>
  );
}
