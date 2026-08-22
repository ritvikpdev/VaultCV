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
    },
  },
  plugins: [],
} satisfies Config;
