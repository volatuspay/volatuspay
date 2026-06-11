import tailwindcssAnimate from "tailwindcss-animate";
import tailwindcssTypography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    // Paths robustos - funcionam tanto no root quanto na pasta client
    "./client/index.html", 
    "./client/src/**/*.{js,jsx,ts,tsx}",
    "./index.html", 
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  safelist: [
    // Cards verdes transparentes - PROTEÇÃO ANTI-PURGE
    'bg-gradient-to-br',
    'backdrop-blur-sm',
    'backdrop-blur-none',
    'from-green-600/20',
    'via-green-700/15', 
    'to-green-900/25',
    'border-green-400/30',
    'hover:border-green-300/50',
    'shadow-xl',
    'hover:shadow-2xl',
    'hover:shadow-green-500/20',
    'from-green-600/25',
    'via-green-700/20',
    'to-green-900/30',
    'border-green-400/40',
    'hover:border-green-300/60',
    'from-yellow-600/20',
    'via-green-600/20',
    'border-yellow-400/50',
    'from-blue-600/20',
    'border-blue-400/40',
    'from-green-600/25',
    'to-pink-600/25',
    // 🔥 CLASSES VIBRANTES PERSONALIZADAS - PROTEÇÃO ANTI-PURGE
    'card-vibrant-purple',
    'card-vibrant-red', 
    'card-vibrant-emerald',
    // Mobile-first gradientes vibrantes
    'from-green-400/95',
    'via-green-500/90',
    'to-green-600/95',
    'from-red-400/95',
    'via-orange-500/90',
    'to-yellow-500/95',
    'from-emerald-400/95',
    'via-green-500/90',
    'to-teal-500/95',
    // Desktop gradientes suaves
    'md:from-green-600/50',
    'md:via-green-700/45',
    'md:to-green-900/55',
    'md:from-red-600/50',
    'md:via-orange-600/45',
    'md:to-yellow-600/55',
    'md:from-emerald-600/50',
    'md:via-green-600/45',
    'md:to-teal-600/55',
    'md:backdrop-blur-sm'
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar-background)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          foreground: "var(--brand-foreground)",
          muted: "var(--brand-muted)",
          "muted-foreground": "var(--brand-muted-foreground)",
          subtle: "var(--brand-subtle)",
          accent: "var(--brand-accent)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        // 🔥 ANIMAÇÕES VIBRANTES PERSONALIZADAS
        "gradient-x": {
          "0%, 100%": {
            "background-position": "0% 50%",
          },
          "50%": {
            "background-position": "100% 50%",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        // 🔥 ANIMAÇÕES VIBRANTES PERSONALIZADAS
        "gradient-x": "gradient-x 4s ease infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate, tailwindcssTypography],
};