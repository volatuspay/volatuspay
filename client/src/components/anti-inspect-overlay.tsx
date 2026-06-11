import { useEffect, useState } from "react";
import { initAntiInspect } from "@/lib/anti-inspect";

export function AntiInspectOverlay() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const cleanup = initAntiInspect(() => setBlocked(true));
    return cleanup;
  }, []);

  if (!blocked) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
        animation: "anti-inspect-border 1.2s infinite",
      }}
    >
      <style>{`
        @keyframes anti-inspect-border {
          0%, 100% { box-shadow: inset 0 0 0 6px #dc2626; }
          50%       { box-shadow: inset 0 0 0 6px #7f1d1d; }
        }
        @keyframes anti-inspect-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.6; }
        }
      `}</style>

      {/* Ícone de alerta */}
      <div style={{ marginBottom: "28px" }}>
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none">
          <path
            d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            stroke="#dc2626"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="12" y1="9" x2="12" y2="13" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="17" x2="12.01" y2="17" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      {/* Título */}
      <h1
        style={{
          color: "#dc2626",
          fontSize: "clamp(22px, 4vw, 36px)",
          fontWeight: 800,
          textAlign: "center",
          marginBottom: "20px",
          fontFamily: "system-ui, sans-serif",
          letterSpacing: "-0.5px",
          animation: "anti-inspect-pulse 1.2s infinite",
        }}
      >
        🚫 Aqui não tem espaço para curioso
      </h1>

      {/* Mensagem */}
      <p
        style={{
          color: "#f87171",
          fontSize: "clamp(14px, 2vw, 18px)",
          textAlign: "center",
          maxWidth: "600px",
          lineHeight: 1.7,
          fontFamily: "system-ui, sans-serif",
          marginBottom: "32px",
        }}
      >
        Atualize a página e <strong style={{ color: "#fff" }}>nunca mais faça isso</strong>.
        <br />
        Para seu IP não ser bloqueado e você perder acesso permanente ao nosso sistema.
      </p>

      {/* Botão de reload */}
      <button
        onClick={() => window.location.reload()}
        style={{
          background: "#dc2626",
          color: "#fff",
          border: "none",
          borderRadius: "8px",
          padding: "14px 36px",
          fontSize: "16px",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "system-ui, sans-serif",
          letterSpacing: "0.3px",
        }}
      >
        Atualizar página
      </button>
    </div>
  );
}
