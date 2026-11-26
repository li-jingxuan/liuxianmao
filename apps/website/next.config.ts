import type { NextConfig } from "next";
import path from "node:path";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");

// Next.js 配置集中在这里，显式声明 monorepo 根目录避免上层 lockfile 干扰。
const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  output: "standalone",
  outputFileTracingRoot: WORKSPACE_ROOT,
  // 仅由授权路由读取的评审素材需要跟随 standalone 产物，以便在运行时选择展示。
  outputFileTracingIncludes: {
    "/previews/ideal/*": ["./assets/marketing/ideal/*"],
  },
  transpilePackages: ["@liuxianmao/lxm-editor", "@liuxianmao/lxm-editor-react"],
  turbopack: {
    root: WORKSPACE_ROOT,
  },
};

export default nextConfig;
