import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 生产镜像使用 standalone server，减少运行时镜像体积
  output: "standalone",
  allowedDevOrigins: ["192.168.124.31", "192.168.124.12"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            // 首页查询参数包含管理密钥，交付页路径包含短期 token，禁止通过 Referer 外泄。
            key: "Referrer-Policy",
            value: "no-referrer",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
