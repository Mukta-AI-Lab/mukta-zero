// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: { DEFAULT: "hsl(var(--surface))", 2: "hsl(var(--surface-2))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          soft: "hsl(var(--primary-soft))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        "brand-warm": "hsl(var(--brand-warm))",
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        border: { DEFAULT: "hsl(var(--border))", strong: "hsl(var(--border-strong))" },
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        mukta: { 100: "#F6F1ED", 500: "#7A5439", 600: "#5F3C24", 700: "#4E301D", 900: "#2C1C10" },
        "teal-deep": "#0E7C86",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      // Escala CRESCENTE e coerente (a anterior era quase plana: lg=16, md=12, sm=10 —
      // então rounded-md num input e rounded-2xl num card pareciam sistemas diferentes).
      borderRadius: { xs: "4px", sm: "6px", md: "8px", lg: "10px", xl: "14px", "2xl": "18px", "3xl": "24px" },
      boxShadow: {
        card: "var(--ui-shadow-card)",
        popup: "var(--ui-shadow-popup)",
        modal: "var(--ui-shadow-modal)",
        composer: "var(--ui-shadow-composer)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(5px)" }, to: { opacity: "1", transform: "none" } },
        "typing-cursor": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0" } },
      },
      animation: {
        "fade-in": "fade-in .3s ease-out",
        "typing-cursor": "typing-cursor 1s step-end infinite",
      },
    },
  },
  plugins: [typography],
};
