import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 生产镜像使用 standalone server，减少运行时镜像体积。
  // Docker 运行阶段复制该目录启动精简版 Next.js 服务。
  output: "standalone",
  // 允许局域网设备在开发模式下加载 Next.js 内部静态资源与 HMR 客户端。
  // 这里只填写可信开发主机名，不使用通配符扩大开发服务器暴露范围。
  allowedDevOrigins: ["192.168.124.31"],
  // 浏览器始终请求同源 /api，Next.js 服务端转发到 FastAPI，避免暴露 API 端口。
  // async rewrites() {
  //   return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  // },
};

export default nextConfig;
