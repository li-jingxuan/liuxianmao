import type { Config } from "tailwindcss";

/** Tailwind 同时扫描网站与编辑器核心包，避免 workspace 类名被裁剪。 */
const tailwindConfig: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/lxm-tabeditor/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: "var(--accent)",
        panel: "var(--panel)",
      },
    },
  },
  plugins: [],
};

export default tailwindConfig;
