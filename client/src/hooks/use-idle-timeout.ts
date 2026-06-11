import { useEffect, useRef, useCallback } from "react";
import { getAuth, signOut } from "firebase/auth";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
const WARNING_MS = 2 * 60 * 1000;       // aviso 2 min antes
const ACTIVITY_EVENTS = [
  "mousemove", "mousedown", "keydown",
  "touchstart", "scroll", "click",
] as const;

/**
 * Auto-logout após 30min de inatividade.
 * Avisa o usuário 2min antes via alert nativo (simples e confiável).
 */
export function useIdleTimeout(enabled = true) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningShownRef = useRef(false);

  const logout = useCallback(async () => {
    try {
      await signOut(getAuth());
    } catch {}
    // Limpa storage e recarrega para tela de login
    localStorage.removeItem("volatuspay_tenant_type");
    localStorage.removeItem("volatuspay_tenant_uid");
    sessionStorage.clear();
    window.location.href = "/auth";
  }, []);

  const resetTimers = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);
    warningShownRef.current = false;

    // Aviso 2min antes
    warningRef.current = setTimeout(() => {
      if (warningShownRef.current) return;
      warningShownRef.current = true;
      const stay = window.confirm(
        "⚠️ Sessão expirando em 2 minutos por inatividade.\nClique OK para continuar conectado."
      );
      if (stay) resetTimers();
    }, IDLE_TIMEOUT_MS - WARNING_MS);

    // Logout automático
    timeoutRef.current = setTimeout(() => {
      logout();
    }, IDLE_TIMEOUT_MS);
  }, [logout]);

  useEffect(() => {
    if (!enabled) return;

    resetTimers();

    const handleActivity = () => resetTimers();
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, handleActivity, { passive: true })
    );

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      ACTIVITY_EVENTS.forEach((e) =>
        window.removeEventListener(e, handleActivity)
      );
    };
  }, [enabled, resetTimers]);
}
