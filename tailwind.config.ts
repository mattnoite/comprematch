import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          yellow: "#FFB400",
          gold: "#CC9B29",
          olive: "#997D3D",
          taupe: "#665A3D",
          dark: "#333029",
        },
      },
    },
  },
  plugins: [],
};

export default config;
