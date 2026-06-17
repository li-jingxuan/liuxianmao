import type { NextConfig } from "next";
import path from "node:path";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");

// Next.js 配置集中在这里，显式声明 monorepo 根目录避免上层 lockfile 干扰。
const nextConfig: NextConfig = {
  turbopack: {
    root: WORKSPACE_ROOT,
  },
};

export default nextConfig;
