import { defineConfig } from "vitest/config";

/** 核心包测试统一运行在 Node 环境，保证领域逻辑不依赖浏览器。 */
export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
  },
});
