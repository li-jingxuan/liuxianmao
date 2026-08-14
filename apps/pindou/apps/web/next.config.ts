import type { NextConfig } from "next";

const apiOrigin = process.env.PINDOU_API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // 生产镜像使用 standalone server，减少运行时镜像体积。
  output: "standalone",
  // 允许局域网设备在开发模式下加载 Next.js 内部静态资源与 HMR 客户端。
  // 这里只填写可信开发主机名，不使用通配符扩大开发服务器暴露范围。
  allowedDevOrigins: ["*"],
  // 浏览器始终请求同源 /api，Next.js 服务端转发到 FastAPI，避免暴露 API 端口。
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
