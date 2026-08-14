import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    // 测试统一放在项目根目录 tests/，避免测试文件与生产代码混排。
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
