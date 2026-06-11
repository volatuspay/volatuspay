import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/theme-context";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
  size?: "sm" | "default";
}

export function ThemeToggle({ className, size = "default" }: ThemeToggleProps) {
  const { theme, toggleTheme, isForced } = useTheme();
  const isDark = theme === "dark";

  if (isForced) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      className={cn(
        "relative transition-all duration-300 active:scale-90",
        size === "sm" ? "h-8 w-8" : "h-9 w-9",
        isDark
          ? "text-violet-300 hover:text-violet-100 hover:bg-violet-500/15 border border-violet-500/20"
          : "text-violet-700 hover:text-violet-900 hover:bg-violet-100 border border-violet-200 shadow-sm",
        className
      )}
    >
      <span className="relative block">
        {isDark ? (
          <Sun className={cn("transition-transform duration-300", size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]")} />
        ) : (
          <Moon className={cn("transition-transform duration-300", size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]")} />
        )}
      </span>
    </Button>
  );
}
