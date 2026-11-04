import type { ComponentProps, ReactNode } from "react";
import { Button } from "antd";
import styles from "./SidebarFrame.module.scss";

export function SidebarFrame({ children, collapsed, collapseBlocked, onCollapse, ...props }:
  ComponentProps<"aside"> & { children: ReactNode; collapsed: boolean; collapseBlocked: boolean; onCollapse: () => void }) {
  return <aside {...props} hidden={collapsed}>
    <div className={styles.title}>
      <strong>编辑台</strong>
      <Button size="small" type="text" disabled={collapseBlocked}
        title={collapseBlocked ? "请先结束输入法组合或处理当前确认" : "收起编辑台"}
        aria-label="收起编辑台" onClick={onCollapse} icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M15 4v16m3-10-2 2 2 2" />
          </svg>
        } />
    </div>
    {children}
  </aside>;
}
