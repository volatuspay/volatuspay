import { LogoThemed } from '@/components/ui/logo-themed';
import { SiteFooter } from '@/components/layout/site-footer';

export default function DenunciaPage() {
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <a href="/" className="flex items-center">
              <LogoThemed type="site" variant="light" className="h-8 w-auto" fallbackText="VolatusPay" />
            </a>
            <nav className="hidden md:flex items-center gap-8">
              <a href="/" className="text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium">Início</a>
              <a href="/legal/terms" className="text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium">Termos</a>
              <a href="/legal/compliance" className="text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium">Compliance</a>
            </nav>
            <a
              href="/register"
              className="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg transition-colors"
              style={{ background: "#2563eb", color: "#fff" }}
            >
              Criar Conta
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">

        {/* Título */}
        <div className="mb-10">
          <p className="text-sm font-semibold tracking-widest uppercase mb-3" style={{ color: "#2563eb" }}>
            Canal de Integridade
          </p>
          <h1 className="text-4xl font-bold text-gray-900 leading-tight mb-4">
            Faça sua Denúncia
          </h1>
          <p className="text-gray-600 text-base leading-relaxed max-w-2xl">
            A VolatusPay opera exclusivamente no mercado de produtos digitais legítimos, cursos, mentorias, e-books
            e serviços honestos. Não trabalhamos e não toleramos conteúdo fraudulento, pirata, enganoso ou que viole
            qualquer regulamentação de consumo.
          </p>
          <p className="text-gray-600 text-base leading-relaxed max-w-2xl mt-3">
            Se você identificou um produto ou vendedor que descumpre essas diretrizes, use este canal para nos comunicar.
            Toda denúncia é tratada com seriedade e confidencialidade.
          </p>
        </div>

        {/* Divisor */}
        <div className="border-t border-gray-100 mb-10" />

        {/* O que denunciamos */}
        <div className="mb-12">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">O que pode ser denunciado</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              'Plágio ou cópia não autorizada de conteúdo',
              'Produto anunciado de forma enganosa',
              'Golpe ou fraude contra o comprador',
              'Produto inexistente ou não entregue',
              'Violação de direitos autorais',
              'Conteúdo ilícito ou proibido por lei',
            ].map(item => (
              <div
                key={item}
                className="flex items-start gap-3 p-4 rounded-xl border border-gray-100 bg-gray-50"
              >
                <span
                  className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}
                >
                  ✓
                </span>
                <span className="text-sm text-gray-700 leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Contato direto */}
        <div
          className="rounded-2xl border p-6 mb-12"
          style={{ background: "#f0f7ff", borderColor: "rgba(37,99,235,0.15)" }}
        >
          <h2 className="text-base font-semibold text-gray-900 mb-4">Contato direto</h2>
          <div className="flex flex-col sm:flex-row gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">E-mail</p>
              <a
                href="mailto:volatuspay@gmail.com"
                className="text-sm font-medium transition-colors"
                style={{ color: "#2563eb" }}
              >
                volatuspay@gmail.com
              </a>
            </div>
            <div className="hidden sm:block w-px bg-gray-200" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">WhatsApp</p>
              <a
                href="https://wa.me/5515998000086"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium transition-colors"
                style={{ color: "#2563eb" }}
              >
                (15) 99800-0086
              </a>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4 leading-relaxed">
            O canal de WhatsApp é monitorado em horário comercial.
          </p>
        </div>

        {/* Nosso compromisso */}
        <div className="pt-10 border-t border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Nosso compromisso</h2>
          <p className="text-sm text-gray-600 leading-relaxed mb-3">
            A VolatusPay existe para servir criadores e vendedores que operam com honestidade. Nossa plataforma não
            aceita produtos de categorias proibidas, conteúdo adulto não regulamentado, esquemas de pirâmide, vendas
            enganosas ou qualquer prática que contrarie o Código de Defesa do Consumidor.
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            Ao receber uma denúncia, abrimos investigação interna e, quando confirmada a irregularidade, suspendemos
            imediatamente a conta infratora e colaboramos com as autoridades competentes. Compradores lesados são
            orientados sobre seus direitos e canais de proteção disponíveis.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
