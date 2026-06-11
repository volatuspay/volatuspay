import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, Download, Share2 } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwa-install-banner-dismissed";
const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000;

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIOSBanner, setShowIOSBanner] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed < DISMISS_DURATION) return;
      localStorage.removeItem(DISMISS_KEY);
    }

    if (isIOS()) {
      setShowIOSBanner(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShowBanner(false);
    setShowIOSBanner(false);
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  }, []);

  if (!showBanner && !showIOSBanner) return null;

  return (
    <div
      className="w-full px-4 py-3 flex items-center gap-3 flex-wrap"
      style={{ backgroundColor: "#050505" }}
      data-testid="pwa-install-banner"
    >
      <div className="flex-1 min-w-0 flex items-center gap-3">
        {showIOSBanner ? (
          <Share2 className="h-5 w-5 flex-shrink-0" style={{ color: "#2563eb" }} />
        ) : (
          <Download className="h-5 w-5 flex-shrink-0" style={{ color: "#2563eb" }} />
        )}
        <p className="text-sm text-white">
          {showIOSBanner
            ? 'Toque em Compartilhar (\u2191) > Adicionar \u00e0 Tela de In\u00edcio'
            : "Instale o app para acesso r\u00e1pido!"}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {showBanner && (
          <Button
            size="sm"
            onClick={handleInstall}
            className="text-black font-semibold border-transparent"
            style={{ backgroundColor: "#2563eb" }}
            data-testid="button-install-pwa"
          >
            <Download className="h-4 w-4 mr-1" />
            Instalar App
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={handleDismiss}
          className="text-white/70 hover:text-white"
          data-testid="button-dismiss-pwa"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
