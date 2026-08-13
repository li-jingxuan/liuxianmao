import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // 测试统一放在项目根目录 tests/，避免测试文件与生产代码混排。
    include: ["tests/**/*.test.ts"],
  },
});
