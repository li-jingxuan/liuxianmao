import type { NextConfig } from "next";

const apiOrigin = process.env.PINDOU_API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // 避免 Next.js 在开发启动时向项目写入框架专用的代理说明文件。
  agentRules: false,
  // 浏览器始终请求同源 /api，开发环境由 Next.js 转发到 FastAPI，避免 CORS 分叉配置。
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
