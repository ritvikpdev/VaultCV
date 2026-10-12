import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // App chrome. Deliberately separate from resume-document styling,
        // which is driven by CSS variables from the resume_styles table.
        canvas: "#f4f2ef",
        surface: "#ffffff",
        ink: "#1a1523",
        muted: "#6b6577",
        line: "#e5e1dc",
        accent: "#e0356f",
        accentSoft: "#fdeaf1",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
      },
      borderRadius: {
        card: "12px",
      },
      boxShadow: {
        // A warm, low lift for cards on hover — tinted with ink rather than
        // pure black so it sits on the beige canvas without looking grey.
        lift: "0 1px 2px rgba(26, 21, 35, 0.04), 0 8px 24px -8px rgba(26, 21, 35, 0.12)",
        panel: "-12px 0 40px -12px rgba(26, 21, 35, 0.25)",
      },
      keyframes: {
        "slide-in": {
          from: { transform: "translateX(24px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "slide-in": "slide-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "fade-in": "fade-in 150ms ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
