/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#080711",
        cardBg: "rgba(13, 11, 28, 0.65)",
        primary: {
          DEFAULT: "#00ff87",
          glow: "rgba(0, 255, 135, 0.4)",
        },
        secondary: {
          DEFAULT: "#00f0ff",
          glow: "rgba(0, 240, 255, 0.4)",
        },
        accent: {
          DEFAULT: "#bd00ff",
          glow: "rgba(189, 0, 255, 0.4)",
        },
        muted: "#8f9bb3",
      },
      fontFamily: {
        sans: ["Outfit", "Inter", "sans-serif"],
        display: ["Orbitron", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        neonGreen: "0 0 15px rgba(0, 255, 135, 0.3)",
        neonCyan: "0 0 15px rgba(0, 240, 255, 0.3)",
        neonPurple: "0 0 15px rgba(189, 0, 255, 0.3)",
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
      },
      animation: {
        "pulse-glow": "pulseGlow 2s infinite ease-in-out",
        "float": "float 6s infinite ease-in-out",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: 0.6, transform: "scale(1)" },
          "50%": { opacity: 1, transform: "scale(1.05)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
    },
  },
  plugins: [],
}
