import { defineConfig } from "vite";
import tailwindcss from "tailwindcss";

export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [tailwindcss({ content: ["./index.html"], corePlugins: ["preflight"] })] } },
  resolve: { dedupe: ["react", "react-dom"] },
  build: { outDir: "dist/renderer", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5179, strictPort: true },
});
