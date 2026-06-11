import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Download, Shield, AlertTriangle, Users, Lock, Eye, TrendingUp, FileCheck } from "lucide-react";
import { useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { auth } from "@/lib/firebase";

export default function KYCReport() {
  const reportRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const downloadPDF = async () => {
    if (!reportRef.current) return;

    const element = reportRef.current;
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
    const imgX = (pdfWidth - imgWidth * ratio) / 2;
    const imgY = 10;

    // Calcular quantas páginas são necessárias
    const totalPages = Math.ceil(imgHeight * ratio / pdfHeight);

    for (let i = 0; i < totalPages; i++) {
      if (i > 0) {
        pdf.addPage();
      }
      const srcY = i * imgHeight / totalPages;
      const srcHeight = imgHeight / totalPages;
      
      pdf.addImage(
        imgData,
        'PNG',
        imgX,
        imgY - (i * pdfHeight),
        imgWidth * ratio,
        imgHeight * ratio
      );
    }

    pdf.save(`VolatusPay_KYC_Antifraude_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const downloadServerPDF = async () => {
    try {
      setDownloading(true);
      const user = auth.currentUser;
      if (!user) {
        alert('Você precisa estar logado para baixar o PDF');
        return;
      }

      const token = await user.getIdToken();
      
      const response = await fetch('/api/admin/download-kyc-pdf', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Erro ao baixar PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `VolatusPay_KYC_Antifraude_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Erro ao baixar PDF:', error);
      alert('Erro ao baixar PDF. Tente novamente.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Relatório KYC e Antifraude</h1>
            <p className="text-muted-foreground">VolatusPay - Processo Completo de Compliance</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={downloadPDF} size="lg" variant="outline">
              <Download className="mr-2 h-5 w-5" />
              PDF Cliente
            </Button>
            <Button onClick={downloadServerPDF} size="lg" disabled={downloading}>
              <Download className="mr-2 h-5 w-5" />
              {downloading ? 'Gerando...' : 'PDF Servidor'}
            </Button>
          </div>
        </div>

        <div ref={reportRef} className="bg-white p-12 space-y-12 text-black">
          {/* Header */}
          <div className="text-center border-b-4 border-emerald-600 pb-8">
            <h1 className="text-5xl font-bold text-emerald-600 mb-4">ZENPAGAMENTOS</h1>
            <h2 className="text-3xl font-bold mb-2">PROCESSO DE KYC E ANTIFRAUDE</h2>
            <p className="text-xl text-brand-muted-foreground">Sistema de Compliance e Segurança Multicamadas</p>
            <div className="mt-6 flex justify-center gap-8 text-sm">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-emerald-600" />
                <span>6 Camadas de Segurança</span>
              </div>
              <div className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-blue-600" />
                <span>AI ThreatGuard</span>
              </div>
              <div className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-orange-600" />
                <span>Monitoramento 24/7</span>
              </div>
            </div>
          </div>

          {/* Seção 1: PLD e KYC */}
          <section className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-emerald-600 p-3 rounded-lg">
                <FileCheck className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">1. Políticas de PLD e KYC</h2>
            </div>

            <div className="bg-emerald-50 border-l-4 border-emerald-600 p-6 rounded-r-lg">
              <h3 className="font-bold text-lg mb-3">PLD (Prevenção à Lavagem de Dinheiro)</h3>
              <ul className="space-y-2 text-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span>Monitoramento automatizado de vendas e saques em busca de transações com volumes e frequência fora do padrão</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span>Dados sensíveis de cartão de crédito NÃO são armazenados (compliance PCI-DSS)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span>Credenciais de sellers criptografadas usando AES-256-GCM com chave mestra (ENCRYPTION_MASTER_KEY)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span>Sistema HSM (Hardware Security Module) para proteção de credenciais sensíveis em memória</span>
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 border-l-4 border-blue-600 p-6 rounded-r-lg">
              <h3 className="font-bold text-lg mb-3">KYC (Know Your Customer)</h3>
              <ul className="space-y-2 text-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>Sellers (PF ou PJ) obrigados a enviar documentos completos antes de vender</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>Sistema de aprovação manual pelo Admin com validação em duas camadas</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>Verificação de CNH, RG, CPF, Comprovante de Residência para PF</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>Verificação de CNPJ, Contrato Social, Documentos de Sócios para PJ</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>Sellers bloqueados até aprovação completa da documentação</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Seção 2: Ferramentas de Prevenção */}
          <section className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-orange-600 p-3 rounded-lg">
                <Shield className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">2. Ferramentas de Prevenção a Fraudes (PLD/FT)</h2>
            </div>

            <div className="bg-gradient-to-br from-orange-50 to-red-50 p-6 rounded-lg border-2 border-orange-300">
              <h3 className="font-bold text-xl mb-4 text-center"> Sistema de Defesa em 6 Camadas</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="font-bold text-orange-600 mb-2">CAMADA 1: Edge Firewall</h4>
                  <p className="text-sm text-foreground">IP Reputation + Geofencing com bloqueio automático de países de alto risco</p>
                </div>
                
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="font-bold text-orange-600 mb-2">CAMADA 2: WAF</h4>
                  <p className="text-sm text-foreground">Web Application Firewall com proteção OWASP Top 10 (SQLi, XSS, CSRF)</p>
                </div>
                
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="font-bold text-orange-600 mb-2">CAMADA 3: IDS/IPS</h4>
                  <p className="text-sm text-foreground">Análise comportamental + Honeypots + Whitelist inteligente</p>
                </div>
                
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="font-bold text-orange-600 mb-2">CAMADA 4: Threat Intelligence</h4>
                  <p className="text-sm text-foreground">Detecção Zero-Day + Resposta automatizada a ameaças</p>
                </div>
                
                <div className="bg-white p-4 rounded-lg shadow-sm col-span-2">
                  <h4 className="font-bold text-orange-600 mb-2">CAMADA 5: AI Security (ThreatGuard AI)</h4>
                  <p className="text-sm text-foreground">Bloqueio automático via Machine Learning de comportamentos suspeitos (EntityBlocker, BlacklistGate, Shadow Mode)</p>
                </div>
              </div>
            </div>

            <div className="bg-brand-subtle p-6 rounded-lg">
              <h3 className="font-bold text-lg mb-3">Análise Interna de Compliance</h3>
              <p className="text-foreground mb-3">
                Todo o processo de análise de PLD e FT é feito internamente pela equipe de compliance da VolatusPay, utilizando:
              </p>
              <ul className="space-y-2 text-foreground">
                <li><strong>Firebase Firestore:</strong> Base de dados principal para histórico de transações e sellers</li>
                <li><strong>Sistema de Audit Logs:</strong> Rastreamento completo de todas as ações com X-Request-ID único</li>
                <li><strong>Dashboard de Chargebacks:</strong> Alertas automáticos quando chargebacks ou estornos ocorrem</li>
                <li><strong>Sistema de Reembolsos:</strong> Análise manual de cada pedido de reembolso pelo seller</li>
              </ul>
            </div>
          </section>

          {/* Seção 3: Critérios de Bloqueio */}
          <section className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-red-600 p-3 rounded-lg">
                <AlertTriangle className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">3. Critérios de Bloqueio e Suspensão</h2>
            </div>

            <div className="bg-red-50 border-l-4 border-red-600 p-6 rounded-r-lg">
              <h3 className="font-bold text-lg mb-3">Limites de Chargeback e Estornos</h3>
              <div className="space-y-3 text-foreground">
                <div className="bg-white p-4 rounded-lg">
                  <p className="font-bold text-red-600 mb-2">Índice acima de 0.7% → Bloqueio Temporário</p>
                  <p className="text-sm">Seller é bloqueado automaticamente e equipe de compliance entra em contato para esclarecimentos</p>
                </div>
                <div className="bg-white p-4 rounded-lg">
                  <p className="font-bold text-red-600 mb-2">Esclarecimentos não plausíveis → Banimento Permanente</p>
                  <p className="text-sm">Conta banida por tempo indeterminado após análise da equipe</p>
                </div>
                <div className="bg-white p-4 rounded-lg">
                  <p className="font-bold text-orange-600 mb-2">Sistema de Single Session Login</p>
                  <p className="text-sm">Previne logins concorrentes e compartilhamento de contas entre sellers</p>
                </div>
              </div>
            </div>
          </section>

          {/* Seção 4: Segmentos de Alto Risco */}
          <section className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-yellow-600 p-3 rounded-lg">
                <TrendingUp className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">4. Segmentos de Alto Risco</h2>
            </div>

            <div className="bg-yellow-50 border-l-4 border-yellow-600 p-6 rounded-r-lg">
              <h3 className="font-bold text-lg mb-3">Setores Considerados de Alto Risco</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-lg text-center shadow-sm">
                  <p className="font-bold text-yellow-700">🎰 Apostas (Bet)</p>
                </div>
                <div className="bg-white p-4 rounded-lg text-center shadow-sm">
                  <p className="font-bold text-yellow-700">💰 Renda Rápida</p>
                </div>
                <div className="bg-white p-4 rounded-lg text-center shadow-sm">
                  <p className="font-bold text-yellow-700">📚 Alguns Infoprodutos</p>
                </div>
              </div>
            </div>

            <div className="bg-orange-50 p-6 rounded-lg">
              <h3 className="font-bold text-lg mb-3">Análise de Sellers de Alto Risco</h3>
              <p className="text-foreground mb-3">
                Para sellers identificados em setores de alto risco, aplicamos margem de tolerância reduzida:
              </p>
              <div className="flex gap-4">
                <div className="flex-1 bg-white p-4 rounded-lg border-2 border-emerald-400">
                  <p className="text-sm text-brand-muted-foreground mb-1">Sellers Normais</p>
                  <p className="text-2xl font-bold text-emerald-600">0.7%</p>
                  <p className="text-sm text-brand-muted-foreground">Limite de Chargeback</p>
                </div>
                <div className="flex-1 bg-white p-4 rounded-lg border-2 border-orange-400">
                  <p className="text-sm text-brand-muted-foreground mb-1">Sellers Alto Risco</p>
                  <p className="text-2xl font-bold text-orange-600">0.4%</p>
                  <p className="text-sm text-brand-muted-foreground">Limite de Chargeback</p>
                </div>
              </div>
            </div>
          </section>

          {/* Seção 5: Contas Fachada */}
          <section className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-indigo-600 p-3 rounded-lg">
                <Eye className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">5. Detecção de Contas Fachada</h2>
            </div>

            <div className="bg-indigo-50 border-l-4 border-indigo-600 p-6 rounded-r-lg">
              <h3 className="font-bold text-lg mb-3">Sistema de Identidade Única (Digital Fingerprint)</h3>
              <p className="text-foreground mb-4">
                Quando um seller é banido ou entra em estado de alerta, documentamos uma sequência de informações que funcionam como identidade única:
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-lg">
                  <p className="font-bold text-indigo-600 mb-2">📍 Endereço IP</p>
                  <p className="text-sm text-brand-muted-foreground">Rastreamento via X-Forwarded-For e dual IP tracking</p>
                </div>
                <div className="bg-white p-4 rounded-lg">
                  <p className="font-bold text-indigo-600 mb-2">💻 Dispositivo</p>
                  <p className="text-sm text-brand-muted-foreground">User-Agent, resolução de tela, timezone</p>
                </div>
                <div className="bg-white p-4 rounded-lg">
                  <p className="font-bold text-indigo-600 mb-2">🌍 Geolocalização</p>
                  <p className="text-sm text-brand-muted-foreground">País, região, cidade do acesso</p>
                </div>
                <div className="bg-white p-4 rounded-lg">
                  <p className="font-bold text-indigo-600 mb-2">🆔 Documentos</p>
                  <p className="text-sm text-brand-muted-foreground">CPF/CNPJ com hash SHA-256 irreversível (LGPD compliant)</p>
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg mt-4">
                <h4 className="font-bold text-indigo-600 mb-2">Detecção de Contas Relacionadas</h4>
                <p className="text-sm text-foreground">
                  Sistema automaticamente detecta quando múltiplas contas compartilham características (mesmo IP, documentos de parentes, dispositivo), 
                  criando um <strong>grafo de relacionamento</strong> e bloqueando todas as contas suspeitas preventivamente.
                </p>
              </div>
            </div>
          </section>

          {/* Seção 6: PEP */}
          <section className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-emerald-600 p-3 rounded-lg">
                <Users className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">6. Verificação de PEP (Pessoas Expostas Politicamente)</h2>
            </div>

            <div className="bg-emerald-50 border-l-4 border-emerald-600 p-6 rounded-r-lg">
              <h3 className="font-bold text-lg mb-3">Processo de Análise de Risco para PEP</h3>
              <ul className="space-y-3 text-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">1.</span>
                  <div>
                    <p className="font-bold">Identificação via Bases de Dados</p>
                    <p className="text-sm">Verificação automática em bases especializadas durante o processo de KYC</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">2.</span>
                  <div>
                    <p className="font-bold">Análise de Risco Rigorosa</p>
                    <p className="text-sm">Sellers identificados como PEP passam por processo de validação adicional com documentação extra</p>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 font-bold">3.</span>
                  <div>
                    <p className="font-bold">Monitoramento Contínuo</p>
                    <p className="text-sm">PEPs recebem atenção especial com monitoramento 24/7 de transações e atividades suspeitas</p>
                  </div>
                </li>
              </ul>
            </div>
          </section>

          {/* Seção 7: Monitoramento */}
          <section className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-emerald-600 p-3 rounded-lg">
                <TrendingUp className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">7. Monitoramento de Transações</h2>
            </div>

            <div className="bg-emerald-50 border-l-4 border-emerald-600 p-6 rounded-r-lg">
              <h3 className="font-bold text-lg mb-3">Frequência e Critérios de Monitoramento</h3>
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-lg">
                  <p className="font-bold text-emerald-600 mb-2"> Análise Semanal + Trigger em Novos Produtos</p>
                  <p className="text-sm text-foreground">
                    Transações e produtos revisados semanalmente, com verificação automática a cada novo produto cadastrado
                  </p>
                </div>
                
                <div className="bg-white p-4 rounded-lg">
                  <p className="font-bold text-emerald-600 mb-2"> Cálculo de Risco Automatizado</p>
                  <p className="text-sm text-foreground mb-2">
                    Sistema gera índice de risco (0-28) baseado em:
                  </p>
                  <ul className="text-sm text-brand-muted-foreground space-y-1 ml-4">
                    <li>• Possibilidade de scam, golpes e fraudes</li>
                    <li>• Categoria do produto (digital, serviço)</li>
                    <li>• Nome e descrição suspeitos</li>
                    <li>• Histórico do seller (chargebacks, vendas)</li>
                  </ul>
                </div>
                
                <div className="bg-white p-4 rounded-lg">
                  <p className="font-bold text-red-600 mb-2">🚨 Sistema de Alertas</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-yellow-50 p-3 rounded border border-yellow-300">
                      <p className="font-bold text-yellow-700">Risco {'>'} 10</p>
                      <p className="text-brand-muted-foreground">Monitoramento constante</p>
                    </div>
                    <div className="bg-red-50 p-3 rounded border border-red-300">
                      <p className="font-bold text-red-700">Risco {'>='} 28</p>
                      <p className="text-brand-muted-foreground">Análise prioritária + bloqueio</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Seção 8: Tecnologias */}
          <section className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-blue-600 p-3 rounded-lg">
                <Lock className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">8. Stack Tecnológico de Segurança</h2>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-emerald-50 p-6 rounded-lg border-2 border-blue-300">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="font-bold text-blue-600 mb-2"> Firebase Ecosystem</h4>
                  <p className="text-sm text-foreground">Firestore, Authentication, Storage, Realtime Database</p>
                </div>
                
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="font-bold text-emerald-600 mb-2"> Criptografia AES-256</h4>
                  <p className="text-sm text-foreground">Encryption Master Key + HSM em memória</p>
                </div>
                
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="font-bold text-emerald-600 mb-2">AI ThreatGuard</h4>
                  <p className="text-sm text-foreground">Machine Learning para bloqueio automático (Shadow Mode)</p>
                </div>
                
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="font-bold text-orange-600 mb-2"> Audit Trails SIEM</h4>
                  <p className="text-sm text-foreground">X-Request-ID, logging completo, compatível com SIEM</p>
                </div>
                
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="font-bold text-red-600 mb-2"> Rate Limiting</h4>
                  <p className="text-sm text-foreground">Express Rate Limit + Redis para proteção DDoS</p>
                </div>
                
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h4 className="font-bold text-indigo-600 mb-2"> Helmet + CSP</h4>
                  <p className="text-sm text-foreground">Headers de segurança HTTP + Content Security Policy</p>
                </div>
              </div>
            </div>
          </section>

          {/* Footer */}
          <div className="border-t-4 border-emerald-600 pt-8 text-center text-sm text-brand-muted-foreground">
            <p className="mb-2">VolatusPay - Gateway de Pagamentos Completo</p>
            <p>Documento gerado em {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
            <p className="mt-4 text-xs">
              Este documento é confidencial e de uso interno. Contém informações sobre processos de compliance, 
              KYC, antifraude e segurança da VolatusPay.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
