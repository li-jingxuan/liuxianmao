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
        aria-label="收起编辑台" onClick={onCollapse}>收起 ›</Button>
    </div>
    {children}
  </aside>;
}
