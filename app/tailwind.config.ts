import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // App chrome. Deliberately separate from resume-document styling,
        // which is driven by CSS variables from the resume_styles table.
        canvas: "#f3f1ee", // warm light grey page background
        surface: "#ffffff",
        ink: "#1c1f3b", // deep navy — primary text and the primary button
        muted: "#6b6d82",
        line: "#e6e3ef",
        field: "#f3f3f7", // input fill
        accent: "#e0356f", // pink — the brand mark, links, active nav
        accentSoft: "#fdeaf1",
        coral: "#ff7a59", // gradient end for Add Content / Done
        violet: "#6c4cf5", // focus rings, active toolbar buttons, AI actions
        violetSoft: "#efebff", // lavender chips
      },
      fontFamily: {
        // --font-ui is Inter, loaded by next/font in the root layout.
        sans: ["var(--font-ui)", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
      },
      boxShadow: {
        // Warm, low shadows tinted with ink rather than pure black, so they
        // sit on the canvas without looking grey.
        card: "0 1px 2px rgba(28, 31, 59, 0.04), 0 2px 8px -2px rgba(28, 31, 59, 0.06)",
        lift: "0 1px 2px rgba(28, 31, 59, 0.04), 0 8px 24px -8px rgba(28, 31, 59, 0.14)",
        panel: "-12px 0 40px -12px rgba(28, 31, 59, 0.25)",
        page: "0 2px 6px rgba(28, 31, 59, 0.06), 0 12px 32px -8px rgba(28, 31, 59, 0.18)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(90deg, #e0356f 0%, #ff7a59 100%)",
      },
      keyframes: {
        "slide-in": {
          from: { transform: "translateX(24px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-16px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "pop-in": {
          from: { transform: "scale(0.97) translateY(-4px)", opacity: "0" },
          to: { transform: "scale(1) translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "slide-in": "slide-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "slide-in-left": "slide-in-left 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "fade-in": "fade-in 150ms ease-out",
        "pop-in": "pop-in 150ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
