import type { NextConfig } from "next";
import path from "node:path";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");

// Next.js 配置集中在这里，显式声明 monorepo 根目录避免上层 lockfile 干扰。
const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  output: "standalone",
  outputFileTracingRoot: WORKSPACE_ROOT,
  transpilePackages: ["@liuxianmao/lxm-editor", "@liuxianmao/lxm-editor-react"],
  turbopack: {
    root: WORKSPACE_ROOT,
  },
};

export default nextConfig;
