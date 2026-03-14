import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: ".75rem",   /* 12px */
        md: ".5rem",    /* 8px */
        sm: ".375rem",  /* 6px */
        xl: "1rem",     /* 16px */
        "2xl": "1.25rem",
      },
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        // Jarvis system accent colors
        "os-blue": {
          DEFAULT: "#3b82f6",
          light: "#60a5fa",
          dark: "#2563eb",
          glow: "rgba(59,130,246,0.15)",
        },
        "os-cyan": {
          DEFAULT: "#06b6d4",
          light: "#22d3ee",
          dark: "#0891b2",
          glow: "rgba(6,182,212,0.15)",
        },
        "os-purple": {
          DEFAULT: "#8b5cf6",
          light: "#a78bfa",
          dark: "#7c3aed",
          glow: "rgba(139,92,246,0.15)",
        },
        "os-green": {
          DEFAULT: "#10b981",
          light: "#34d399",
          dark: "#059669",
          glow: "rgba(16,185,129,0.15)",
        },
        status: {
          online: "rgb(16 185 129)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(100 116 139)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "Consolas", "monospace"],
      },
      backgroundImage: {
        "os-grid": "linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)",
        "os-gradient": "linear-gradient(135deg, #0f1629 0%, #0a0f1e 50%, #060b18 100%)",
        "os-glow": "radial-gradient(ellipse at center, rgba(59,130,246,0.15) 0%, transparent 70%)",
      },
      backgroundSize: {
        "os-grid": "40px 40px",
      },
      boxShadow: {
        "os-glow-sm": "0 0 10px rgba(59,130,246,0.2), 0 0 20px rgba(59,130,246,0.05)",
        "os-glow": "0 0 20px rgba(59,130,246,0.3), 0 0 40px rgba(59,130,246,0.1)",
        "os-glow-lg": "0 0 40px rgba(59,130,246,0.4), 0 0 80px rgba(59,130,246,0.15)",
        "os-card": "0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)",
        "os-panel": "0 8px 32px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.05)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "1", boxShadow: "0 0 8px rgba(59,130,246,0.5)" },
          "50%": { opacity: "0.7", boxShadow: "0 0 16px rgba(59,130,246,0.8), 0 0 32px rgba(59,130,246,0.3)" },
        },
        "pulse-dot": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.3)", opacity: "0.8" },
        },
        "scan-line": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-in-left": {
          "0%": { opacity: "0", transform: "translateX(-16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "typing-dot": {
          "0%, 60%, 100%": { transform: "translateY(0)" },
          "30%": { transform: "translateY(-4px)" },
        },
        "status-ring": {
          "0%": { transform: "scale(1)", opacity: "0.8" },
          "100%": { transform: "scale(2)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% center" },
          "100%": { backgroundPosition: "200% center" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "pulse-dot": "pulse-dot 1.5s ease-in-out infinite",
        "scan-line": "scan-line 3s linear infinite",
        "fade-in-up": "fade-in-up 0.3s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
        "slide-in-left": "slide-in-left 0.25s ease-out",
        "typing-dot": "typing-dot 1.2s ease-in-out infinite",
        "status-ring": "status-ring 1.5s ease-out infinite",
        shimmer: "shimmer 2s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
