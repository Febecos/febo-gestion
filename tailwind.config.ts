import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        febo: {
          azul: "#2563eb",
          cyan: "#0891b2",
          verde: "#059669",
          violeta: "#7c3aed",
        },
      },
    },
  },
  plugins: [],
};
export default config;
