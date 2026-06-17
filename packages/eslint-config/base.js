import js from "@eslint/js";
import tseslint from "typescript-eslint";

const IGNORED_PATHS = ["dist/**", "build/**", ".next/**", "node_modules/**"];

// 基础规则集中维护，所有 workspace 包默认继承这里的 TypeScript 约束。
const baseConfig = tseslint.config(
  {
    ignores: IGNORED_PATHS,
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
);

export default baseConfig;
