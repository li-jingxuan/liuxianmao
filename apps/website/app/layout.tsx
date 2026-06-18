import type { Metadata } from "next";
import type React from "react";
import type { ReactNode } from "react";
import "./globals.scss";

export const metadata: Metadata = {
  title: "六线猫",
  description: "六线谱编辑器静态界面",
};

interface RootLayoutProps {
  children: ReactNode;
}

// 根布局负责注入全局 HTML 结构，页面级内容保持在各自 route 中维护。
const RootLayout: React.FC<RootLayoutProps> = ({ children }) => {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
};

export default RootLayout;
