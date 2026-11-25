import editorConfig from "@liuxianmao/eslint-config/next";

// 沿用迁移前的 React Hooks 与 TypeScript 规则。公共组件可挂载在普通 Web 或 Electron 中。
export default [...editorConfig, {
  rules: {
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
  },
}];
