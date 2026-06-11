import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let _deferredPrompt: BeforeInstallPromptEvent | null = null;
const _listeners: Array<(e: BeforeInstallPromptEvent | null) => void> = [];

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    _deferredPrompt = e as BeforeInstallPromptEvent;
    _listeners.forEach((fn) => fn(_deferredPrompt));
  });
  window.addEventListener("appinstalled", () => {
    _deferredPrompt = null;
    _listeners.forEach((fn) => fn(null));
  });
}

function usePwaPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(_deferredPrompt);
  useEffect(() => {
    _listeners.push(setPrompt);
    return () => {
      const idx = _listeners.indexOf(setPrompt);
      if (idx !== -1) _listeners.splice(idx, 1);
    };
  }, []);
  return prompt;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

const IconCheck = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconAndroid = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.523 15.341l1.122 1.944a.5.5 0 0 1-.183.683.5.5 0 0 1-.683-.183l-1.14-1.976A7.97 7.97 0 0 1 12 17a7.97 7.97 0 0 1-4.639-1.191l-1.14 1.976a.5.5 0 0 1-.683.183.5.5 0 0 1-.183-.683l1.122-1.944A7.967 7.967 0 0 1 4 9h16a7.967 7.967 0 0 1-2.477 6.341zM9 11.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM7.76 4.31l-1.06-1.836a.25.25 0 0 1 .433-.25l1.074 1.86A7.94 7.94 0 0 1 12 3.5c1.374 0 2.668.348 3.793.984l1.074-1.86a.25.25 0 1 1 .433.25L16.24 4.31A7.999 7.999 0 0 1 20 9H4a7.999 7.999 0 0 1 3.76-4.69z"/>
  </svg>
);

interface PwaInstallButtonsProps {
  size?: "sm" | "md";
  className?: string;
}

export function PwaInstallButtons({ size = "md", className = "" }: PwaInstallButtonsProps) {
  const prompt = usePwaPrompt();
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    const handler = () => setInstalled(true);
    window.addEventListener("appinstalled", handler);
    return () => window.removeEventListener("appinstalled", handler);
  }, []);

  const handleAndroid = useCallback(async () => {
    if (!prompt) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setInstalled(true);
    } finally {
      setInstalling(false);
    }
  }, [prompt]);

  const btnSm: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: 8, padding: "10px 20px", borderRadius: 999,
    fontWeight: 600, fontSize: 13, cursor: "pointer",
    border: "none", transition: "opacity 0.15s",
  };
  const btnMd: React.CSSProperties = {
    ...btnSm, padding: "13px 28px", fontSize: 15, fontWeight: 700,
  };
  const btn = size === "sm" ? btnSm : btnMd;

  if (installed) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#2563eb", fontSize: 13, fontWeight: 600 }}>
        <IconCheck />
        App instalado com sucesso
      </div>
    );
  }

  return (
    <div className={className} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "center" }}>
      <button
        onClick={handleAndroid}
        disabled={!prompt || installing}
        style={{
          ...btn,
          backgroundColor: prompt ? "#2563eb" : "rgba(127,223,0,0.18)",
          color: prompt ? "#fff" : "rgba(127,223,0,0.5)",
          opacity: installing ? 0.7 : 1,
          cursor: prompt ? "pointer" : "default",
        }}
      >
        <IconAndroid />
        {installing ? "Instalando..." : "Baixar App Android"}
      </button>
    </div>
  );
}
