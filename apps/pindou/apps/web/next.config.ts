import type { NextConfig } from "next";

// const apiOrigin = process.env.PINDOU_API_ORIGIN ?? "http://192.168.124.22:8000";

// console.log('----- apiOrigin -----', apiOrigin);
const nextConfig: NextConfig = {
  // 允许局域网设备在开发模式下加载 Next.js 内部静态资源与 HMR 客户端。
  // 这里只填写可信开发主机名，不使用通配符扩大开发服务器暴露范围。
  allowedDevOrigins: ["192.168.124.22"],
  // 避免 Next.js 在开发启动时向项目写入框架专用的代理说明文件。
  // agentRules: false,
  // 浏览器始终请求同源 /api，开发环境由 Next.js 转发到 FastAPI，避免 CORS 分叉配置。
  // async rewrites() {
  //   return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  // },
};

export default nextConfig;
