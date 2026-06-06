import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#061019",
        glow: "#8ad4ff",
        plum: "#3c1f52",
        mist: "#9fb6cc"
      },
      boxShadow: {
        panel: "0 24px 80px rgba(4, 12, 24, 0.45)"
      },
      borderRadius: {
        "4xl": "2rem"
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "Noto Sans SC", "system-ui", "sans-serif"]
      },
      backgroundImage: {
        aurora:
          "radial-gradient(circle at top left, rgba(95, 170, 255, 0.28), transparent 32%), radial-gradient(circle at top right, rgba(255, 132, 82, 0.18), transparent 28%), linear-gradient(180deg, rgba(8, 17, 27, 0.94), rgba(4, 10, 18, 1))"
      }
    }
  },
  plugins: []
} satisfies Config;
