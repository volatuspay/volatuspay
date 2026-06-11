import { useEffect, useRef } from "react";
import { useTheme } from "@/contexts/theme-context";

interface PublicPageWrapperProps {
  children: React.ReactNode;
}

export function PublicPageWrapper({ children }: PublicPageWrapperProps) {
  const { theme, setTheme } = useTheme();
  const prevTheme = useRef(theme);

  useEffect(() => {
    const prev = prevTheme.current;
    setTheme("light");
    return () => {
      setTheme(prev);
    };
  }, []);

  return <>{children}</>;
}
