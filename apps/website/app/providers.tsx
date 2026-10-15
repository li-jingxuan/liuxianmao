"use client";

import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";

/** 全站统一注入 Ant Design 主题与中文组件文案，避免页面各自覆盖 token。 */
export const AppProviders = ({ children }: { children: ReactNode }) => (
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: "#285BE0",
        colorText: "#202838",
        colorTextSecondary: "#626E82",
        colorSuccess: "#19734F",
        colorWarning: "#92600C",
        colorError: "#BC3547",
        colorBgLayout: "#F4F6FA",
        colorBgContainer: "#FFFFFF",
        colorBorder: "#D9D9D9",
        borderRadius: 6,
        controlHeight: 32,
        controlHeightSM: 24,
        controlHeightLG: 40,
      },
    }}
  >
    <App>{children}</App>
  </ConfigProvider>
);
