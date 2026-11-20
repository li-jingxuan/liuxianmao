import { Button } from "antd";
import type { ReactNode } from "react";
import type { SidebarContext, SidebarLocation } from "./sidebar-context";
import styles from "../workspace/SidebarFrame.module.scss";
export function SidebarObjectContext({ context, onCurrentSelection, compact = false, action }:
  { context: SidebarContext; onLocate: (location: SidebarLocation) => void; onCurrentSelection?: () => void; compact?: boolean; action?: ReactNode }) {
  return <div className={styles.context} aria-label="当前编辑对象">
    <div className={styles.contextTop}>
      <strong>{compact && context.valid ? context.position : context.title}</strong>
      {action}
    </div>
    {!compact && <div className={styles.contextBottom}><p>{context.position}</p>{context.scope && <span>{context.scope}</span>}</div>}
    {context.reason && <p role="status">{context.reason}</p>}
    {context.differentSelection && context.location?.kind !== "lyric" && context.location?.kind !== "numbered" && <p>正在编辑原位置</p>}
    {context.differentSelection && context.location?.kind !== "lyric" && context.location?.kind !== "numbered" && onCurrentSelection && <Button size="small" type="link" onClick={onCurrentSelection}>切换到当前选区</Button>}
  </div>;
}
