import baseConfig from "@liuxianmao/eslint-config/base";

/** 核心包复用 workspace 基础规则，脚本文件额外声明 Node 运行时全局。 */
export default [
  ...baseConfig,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
];
