import { defineConfig } from "vitest/config";

/** 独立生成完整页面验收谱例；正式多场景回归另由标准测试集合执行。 */
export default defineConfig({
  test: { include: ["artifacts/technique-screenshot-diagnosis/repro.ts"] },
});
