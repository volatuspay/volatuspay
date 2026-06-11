import { Link } from "wouter";

const SUPPORT_WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP || "5515998000086";
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "";
const PLATFORM_NAME = import.meta.env.VITE_PLATFORM_NAME || "VolatusPay";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer
      style={{ background: "#f8fafc", borderTop: "1px solid #e5e7eb" }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 2rem" }}>

        {/* Grid principal - 4 colunas, marca com 2× de largura */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr",
            gap: "3rem",
            padding: "4rem 0 3.5rem",
          }}
          className="footer-main-grid"
        >
          {/* Coluna 1 - Marca */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <img
              src="/logo-volatuspay.png"
              alt={PLATFORM_NAME}
              style={{ height: 36, width: "auto", objectFit: "contain", objectPosition: "left center" }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
            <p style={{ color: "#6b7280", fontSize: "0.875rem", lineHeight: 1.7, maxWidth: 280 }}>
              Plataforma de pagamentos para infoprodutores com saque D+0, as
              melhores taxas e segurança de ponta.
            </p>
            {SUPPORT_EMAIL && (
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                style={{ color: "#9ca3af", fontSize: "0.75rem", textDecoration: "none" }}
              >
                {SUPPORT_EMAIL}
              </a>
            )}
          </div>

          {/* Coluna 2 - Plataforma */}
          <div>
            <p style={{ marginBottom: "1.25rem", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "#9ca3af" }}>
              Plataforma
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {[
                { label: "Soluções", href: "/#ecossistema" },
                { label: "Benefícios", href: "/#beneficios" },
                { label: "Funcionalidades", href: "/#funcionalidades" },
                { label: "Taxas", href: "/#taxas" },
                { label: "FAQ", href: "/#faq" },
              ].map(({ label, href }) => (
                <li key={label}>
                  <a href={href} style={{ color: "#6b7280", fontSize: "0.875rem", textDecoration: "none" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#2563eb")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Coluna 3 - Legal */}
          <div>
            <p style={{ marginBottom: "1.25rem", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "#9ca3af" }}>
              Legal
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {[
                { label: "Termos de Uso", href: "/legal/terms" },
                { label: "Privacidade", href: "/legal/privacy" },
                { label: "Reembolso", href: "/legal/refund" },
                { label: "Compliance", href: "/legal/compliance" },
                { label: "Canal de Denúncias", href: "/legal/denuncia" },
              ].map(({ label, href }) => (
                <li key={label}>
                  <Link href={href} style={{ color: "#6b7280", fontSize: "0.875rem", textDecoration: "none" }}
                    onMouseEnter={(e: any) => (e.currentTarget.style.color = "#2563eb")}
                    onMouseLeave={(e: any) => (e.currentTarget.style.color = "#6b7280")}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Coluna 4 - Contato */}
          <div>
            <p style={{ marginBottom: "1.25rem", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "#9ca3af" }}>
              Contato
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {SUPPORT_WHATSAPP && (
                <div>
                  <span style={{ display: "block", fontSize: "0.7rem", color: "#9ca3af", marginBottom: "0.2rem" }}>WhatsApp</span>
                  <a
                    href={`https://wa.me/${SUPPORT_WHATSAPP}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#374151", fontSize: "0.875rem", fontWeight: 500, textDecoration: "none" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#2563eb")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#374151")}
                  >
                    (15) 99800-0086
                  </a>
                </div>
              )}
              <div>
                <span style={{ display: "block", fontSize: "0.7rem", color: "#9ca3af", marginBottom: "0.2rem" }}>Horário</span>
                <span style={{ color: "#374151", fontSize: "0.875rem" }}>Seg–Sex, 9h–18h</span>
              </div>
            </div>
          </div>
        </div>

        {/* Barra inferior */}
        <div style={{ borderTop: "1px solid #e5e7eb", padding: "1.75rem 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", textAlign: "center" }}>
          <p style={{ color: "#9ca3af", fontSize: "0.75rem", margin: 0, fontWeight: 500 }}>
            VOLATUSPAY TECNOLOGIA DE PAGAMENTOS LTDA - CNPJ 60.416.460/0001-27
          </p>
          <p style={{ color: "#b0b8c8", fontSize: "0.7rem", margin: 0 }}>
            Rua Benedito Toledo Vieira, 304 - Condomínio Dona Núria - Porto Feliz/SP - CEP 18.545-106
          </p>
          <p style={{ color: "#9ca3af", fontSize: "0.75rem", margin: 0 }}>
            &copy; {year} {PLATFORM_NAME}. Todos os direitos reservados.
          </p>
        </div>
      </div>

      {/* Responsivo: colapsa para 2 colunas em tela pequena */}
      <style>{`
        @media (max-width: 768px) {
          .footer-main-grid {
            grid-template-columns: 1fr 1fr !important;
            gap: 2rem !important;
          }
        }
        @media (max-width: 480px) {
          .footer-main-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </footer>
  );
}
