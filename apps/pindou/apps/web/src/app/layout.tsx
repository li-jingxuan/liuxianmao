import type { Metadata, Viewport } from "next";
import "./globals.css";

// App Router 的静态页面元信息，在服务端构建阶段写入 head。
export const metadata: Metadata = {
  title: "拼豆图片转换器",
  description: "把喜欢的图片变成拼豆图纸",
};

// 固定移动端逻辑视口，保证设计稿断点与真实设备宽度一致。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f8ff",
};

/** 全站根布局：声明中文语言环境并加载共享样式。 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
