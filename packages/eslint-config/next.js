import baseConfig from "./base.js";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// Next.js 16 已直接导出 flat config，这里只负责组合项目通用规则。
const nextConfig = [...nextCoreWebVitals, ...nextTypeScript];

export default [...baseConfig, ...nextConfig];
