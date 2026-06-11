import "./landing-page.css";
import { Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { SiteFooter } from "@/components/layout/site-footer";

const WHATSAPP_URL = "https://wa.me/5521965456958?text=Ol%C3%A1%21%20Gostaria%20de%20entrar%20em%20contato%20para%20conhecer%20melhor%20a%20VolatusPay.";
const PLATFORM_NAME = import.meta.env.VITE_PLATFORM_NAME || "VolatusPay";


function useHeroCanvas(canvasRef: React.RefObject<HTMLCanvasElement>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const PURPLE = "37,99,235";
    const LAVENDER = "59,130,246";

    function resize() {
      canvas!.width = canvas!.offsetWidth;
      canvas!.height = canvas!.offsetHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    interface Particle {
      x: number; y: number; vx: number; vy: number;
      radius: number; alpha: number;
      update(): void; draw(): void;
    }
    interface GridLine {
      vertical: boolean; pos: number; speed: number;
      alpha: number; draw(): void;
    }

    function makeParticle(): Particle {
      const W = canvas!.width, H = canvas!.height;
      return {
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
        radius: Math.random() * 1.5 + 0.3,
        alpha: Math.random() * 0.5 + 0.1,
        update() {
          this.x += this.vx; this.y += this.vy;
          if (this.x < 0) this.x = W; if (this.x > W) this.x = 0;
          if (this.y < 0) this.y = H; if (this.y > H) this.y = 0;
        },
        draw() {
          ctx!.beginPath();
          ctx!.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(${LAVENDER},${this.alpha})`;
          ctx!.fill();
        },
      };
    }

    function makeGridLine(vertical: boolean, pos: number): GridLine {
      return {
        vertical, pos,
        speed: (Math.random() - 0.5) * 0.2,
        alpha: Math.random() * 0.08 + 0.02,
        draw() {
          const W = canvas!.width, H = canvas!.height;
          ctx!.beginPath();
          ctx!.strokeStyle = `rgba(${PURPLE},${this.alpha})`;
          ctx!.lineWidth = 0.5;
          if (this.vertical) { ctx!.moveTo(this.pos, 0); ctx!.lineTo(this.pos, H); }
          else { ctx!.moveTo(0, this.pos); ctx!.lineTo(W, this.pos); }
          ctx!.stroke();
        },
      };
    }

    let particles: ReturnType<typeof makeParticle>[] = [];
    let lines: ReturnType<typeof makeGridLine>[] = [];

    function init() {
      const W = canvas!.width, H = canvas!.height;
      particles = Array.from({ length: 120 }, makeParticle);
      lines = [];
      const cols = Math.ceil(W / 80), rows = Math.ceil(H / 80);
      for (let i = 0; i <= cols; i++) lines.push(makeGridLine(true, i * 80));
      for (let j = 0; j <= rows; j++) lines.push(makeGridLine(false, j * 80));
    }
    init();
    window.addEventListener("resize", init);

    interface Star { x: number; y: number; len: number; speed: number; alpha: number; angle: number; }
    let star: Star | null = null;
    let starTimer = 0;

    function spawnStar() {
      const W = canvas!.width, H = canvas!.height;
      star = {
        x: Math.random() * W * 0.7, y: Math.random() * H * 0.4,
        len: Math.random() * 120 + 80, speed: Math.random() * 6 + 6,
        alpha: 1, angle: Math.PI / 4 + (Math.random() - 0.5) * 0.3,
      };
    }

    function drawStar() {
      if (!star) return;
      const dx = Math.cos(star.angle) * star.speed;
      const dy = Math.sin(star.angle) * star.speed;
      star.x += dx; star.y += dy; star.alpha -= 0.025;
      if (star.alpha <= 0) { star = null; return; }
      const grad = ctx!.createLinearGradient(
        star.x - dx * star.len / star.speed, star.y - dy * star.len / star.speed,
        star.x, star.y
      );
      grad.addColorStop(0, `rgba(${LAVENDER},0)`);
      grad.addColorStop(1, `rgba(255,255,255,${star.alpha * 0.8})`);
      ctx!.beginPath();
      ctx!.moveTo(star.x - dx * star.len / star.speed, star.y - dy * star.len / star.speed);
      ctx!.lineTo(star.x, star.y);
      ctx!.strokeStyle = grad;
      ctx!.lineWidth = 1.5;
      ctx!.stroke();
    }

    function animate() {
      animId = requestAnimationFrame(animate);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      lines.forEach(l => l.draw());
      particles.forEach(p => { p.update(); p.draw(); });
      starTimer++;
      if (starTimer > 200 && !star) { spawnStar(); starTimer = 0; }
      drawStar();
    }
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("resize", init);
    };
  }, [canvasRef]);
}

function useReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => { entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("visible"); }); },
      { threshold: 0.08 }
    );
    document.querySelectorAll(".zen-reveal").forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}


const FAQ_ITEMS = [
  {
    q: "Como funciona a taxa por transação?",
    a: "Na VolatusPay, você não paga mensalidade. A taxa é 100% personalizada de acordo com o tamanho e o modelo da sua operação, podendo ser a partir de R$ 0,99 fixo por venda, ou um modelo híbrido de Fixo + % por transação aprovada.",
  },
  {
    q: "Quanto tempo demora para o dinheiro cair na conta?",
    a: "Para pagamentos via Pix, o saldo fica disponível instantaneamente. Boletos levam até 1 dia útil após o pagamento. Cartões de crédito podem ser configurados para recebimento em 2, 14 ou 30 dias.",
  },
  {
    q: "Preciso de CNPJ para começar a usar?",
    a: "Não! Você pode criar sua conta e começar a vender usando seu CPF. Conforme seu negócio for crescendo, você pode migrar facilmente para uma conta PJ sem interromper suas vendas.",
  },
  {
    q: "Como funciona o suporte ao cliente?",
    a: "Nosso suporte está disponível 24/7 via chat, WhatsApp e e-mail. Cada conta tem acesso a um gerente dedicado para dúvidas técnicas, financeiras e estratégicas.",
  },
  {
    q: "É possível integrar com minha plataforma atual?",
    a: "Sim! Temos API REST documentada e integrações nativas com os principais checkouts do mercado. Nossa equipe técnica auxilia na integração sem custo adicional.",
  },
];

export default function Landing() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useHeroCanvas(canvasRef);
  useReveal();

  useEffect(() => {
    const orig = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "#ffffff";
    document.body.style.overflowX = "hidden";
    return () => {
      document.body.style.backgroundColor = orig;
      document.body.style.overflowX = "";
    };
  }, []);

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="zen-lp">
      {/* ── NAV ── */}
      <nav className="zen-nav">
        <div className="zen-nav-inner">
          <a href="/" className="zen-logo">
            <img src="/logo-volatuspay.png" alt={PLATFORM_NAME} style={{ height: "36px", width: "auto", objectFit: "contain" }} />
          </a>

          <div className="zen-nav-links">
            <a href="#diferenciais">Diferenciais</a>
            <a href="#faq">FAQ</a>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">Suporte</a>
          </div>

          <div className="zen-nav-actions">
            <Link href="/login" className="zen-btn-login">Login</Link>
            <Link href="/register" className="zen-btn-cta">Começar</Link>
            <button className="zen-hamburger" onClick={() => setMobileOpen(p => !p)} aria-label="Menu">
              <span /><span /><span />
            </button>
          </div>
        </div>
      </nav>

      {/* MOBILE MENU */}
      {mobileOpen && (
        <div className="zen-mobile-menu open">
          <a href="#diferenciais" onClick={closeMobile}>Diferenciais</a>
          <a href="#faq" onClick={closeMobile}>FAQ</a>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" onClick={closeMobile}>Suporte</a>
          <div className="zen-mobile-actions">
            <Link href="/register" className="zen-btn-cta" onClick={closeMobile}>Criar conta</Link>
            <Link href="/login" className="zen-btn-ghost" onClick={closeMobile}>Entrar</Link>
          </div>
        </div>
      )}

      {/* ── HERO ── */}
      <section className="zen-hero" id="inicio">
        <canvas className="zen-hero-canvas" ref={canvasRef} />
        <div className="zen-hero-glow-tl" />
        <div className="zen-hero-glow-b" />
        <div className="zen-hero-aurora" style={{ width: 600, height: 600, background: "rgba(37,99,235,0.07)", top: "10%", left: "-10%" }} />
        <div className="zen-hero-aurora" style={{ width: 500, height: 500, background: "rgba(59,130,246,0.05)", top: "40%", right: "-5%" }} />
        <div className="zen-hero-aurora" style={{ width: 400, height: 300, background: "rgba(96,165,250,0.06)", bottom: "20%", left: "30%" }} />
        <div className="zen-hero-ring" style={{ width: 500, height: 500 }} />
        <div className="zen-hero-ring" style={{ width: 750, height: 750, animationDelay: "-1.5s" }} />
        <div className="zen-hero-ring" style={{ width: 1000, height: 1000, animationDelay: "-3s", borderColor: "rgba(37,99,235,0.04)" }} />

        <div className="zen-hero-content">
          <div className="zen-hero-badge">
            <span className="zen-badge-pill">Tudo em um só lugar</span>
            <span className="zen-badge-text">Checkout · Membros · Afiliados · D+0</span>
          </div>
          <h1 className="zen-hero-title">A plataforma que escala seu infoproduto.</h1>
          <p className="zen-hero-sub">Do checkout à área de membros - afiliados, assinaturas, upsell e saque D+0 integrados para você vender mais todo dia.</p>
          <Link href="/register" className="zen-btn-hero">
            Criar conta grátis
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

      </section>

      {/* ── FEATURES ── */}
      <section className="zen-features" id="diferenciais">
        <div className="zen-features-title zen-reveal">
          <h2>Tudo que seu negócio precisa.</h2>
          <h2 className="dim">Em uma plataforma só.</h2>
        </div>
        <div className="zen-features-grid">
          {[
            { title: "Área de Membros", desc: "Entrega automática de acesso ao conteúdo após a compra. Cursos, comunidades e infoprodutos com login próprio para cada aluno." },
            { title: "Afiliados & Vitrine", desc: "Progama de afiliados com painel dedicado, comissões automáticas e vitrine pública para divulgação dos seus produtos." },
            { title: "Assinaturas Recorrentes", desc: "Cobranças automáticas semanais, mensais ou anuais. Gestão completa de planos, trials, upgrades e cancelamentos." },
            { title: "Order Bump & Upsell", desc: "Aumente o ticket médio com ofertas complementares no checkout e ofertas de upsell logo após a compra, com 1 clique." },
            { title: "Backredirect", desc: "Redirecione o visitante para uma página estratégica ao tentar sair do checkout, aumentando a recuperação de vendas." },
            { title: "Split Automático", desc: "Divida pagamentos instantaneamente entre múltiplos parceiros, coproduções ou fornecedores com regras personalizadas." },
            { title: "Pix, Boleto e Cartão", desc: "Todos os métodos de pagamento integrados em uma única plataforma, sem burocracia, sem integrações extras." },
            { title: "Saque D+0", desc: "Seu dinheiro na conta no mesmo dia. Sem espera, sem estresse, com total controle do seu fluxo de caixa." },
            { title: "Segurança Antifraude", desc: "IA avançada que analisa cada transação em milissegundos para bloquear fraudes antes que aconteçam." },
          ].map((feat, i) => (
            <div key={i} className="zen-feature-box zen-reveal">
              <div className="zen-feature-icon">
                <img src="/images/fiveiconpay.png" alt="" width="32" height="32" style={{ objectFit: 'contain' }} />
              </div>
              <div className="zen-feature-title">{feat.title}</div>
              <p className="zen-feature-desc">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── STATS ── */}
      <div className="zen-stats">
        <div className="zen-stats-inner">
          {[
            { num: "+3k", lbl: "Transações por dia" },
            { num: "98.7%", lbl: "Taxa de aprovação" },
            { num: "D+0", lbl: "Liquidez imediata" },
            { num: "24/7", lbl: "Suporte disponível" },
          ].map((s, i) => (
            <div key={i} className="zen-reveal">
              <div className="zen-stat-num">{s.num}</div>
              <div className="zen-stat-label">{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── FAQ ── */}
      <section className="zen-faq" id="faq">
        <div className="zen-faq-left">
          <div className="zen-section-tag">
            <span className="zen-tag-dot" />
            <span>Suporte</span>
          </div>
          <h2>
            <span className="white">Perguntas</span>
            <span className="gray">Frequentes</span>
          </h2>
          <p>Tem dúvidas sobre o VolatusPay? Nossa seção de FAQ tem as respostas rápidas para as questões mais comuns.</p>
        </div>
        <div className="zen-faq-list">
          {FAQ_ITEMS.map((item, i) => (
            <div
              key={i}
              className={`zen-faq-item${openFaq === i ? " open" : ""}`}
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
            >
              <div className="zen-faq-question">
                <h3>{item.q}</h3>
                <div className="zen-faq-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
              </div>
              <div className="zen-faq-answer"><p>{item.a}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section className="zen-cta zen-reveal">
        <h2>Pronto para vender<br /><span className="accent">sem limite?</span></h2>
        <p>Crie sua conta gratuitamente.</p>
        <div className="zen-cta-actions">
          <Link href="/register" className="zen-btn-hero">Criar conta grátis</Link>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="zen-btn-ghost">
            Falar com especialista
          </a>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <SiteFooter />

    </div>
  );
}
