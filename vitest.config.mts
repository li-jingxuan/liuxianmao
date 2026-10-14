import { defineConfig } from "vitest/config";

/** 网站采用 React 自动 JSX runtime，SSR 交互提示测试使用相同编译方式。 */
export default defineConfig({ esbuild: { jsx: "automatic" } });
