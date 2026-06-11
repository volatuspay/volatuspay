import { cn } from "@/lib/utils";

interface LogoThemedProps {
  type: "header" | "site";
  alt?: string;
  className?: string;
  fallbackText?: string;
  showFallbackIcon?: boolean;
  variant?: "dark" | "light";
  "data-testid"?: string;
}

export function LogoThemed({
  type,
  alt,
  className,
  fallbackText,
  variant,
  "data-testid": testId,
}: LogoThemedProps) {
  const height = type === "header" ? 32 : 40;

  return (
    <img
      src="/logo-volatuspay.png"
      alt={alt || fallbackText || "VolatusPay"}
      style={{ height, width: "auto", objectFit: "contain" }}
      className={cn(className)}
      data-testid={testId || `logo-${type}`}
    />
  );
}
