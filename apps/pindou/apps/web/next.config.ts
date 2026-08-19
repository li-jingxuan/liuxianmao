import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 生产镜像使用 standalone server，减少运行时镜像体积
  output: "standalone",
  allowedDevOrigins: ["192.168.124.31", "192.168.124.12"],
};

export default nextConfig;
