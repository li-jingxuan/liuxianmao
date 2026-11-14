import { Button } from "antd";
import { AimOutlined } from "@ant-design/icons";
import type { SidebarContext, SidebarLocation } from "./sidebar-context";
import styles from "../workspace/SidebarFrame.module.scss";
export function SidebarObjectContext({ context, onLocate, onCurrentSelection, compact = false }:
  { context: SidebarContext; onLocate: (location: SidebarLocation) => void; onCurrentSelection?: () => void; compact?: boolean }) {
  return <div className={styles.context} aria-label="当前编辑对象">
    <div className={styles.contextTop}>
      <strong>{compact && context.valid ? context.position : context.title}</strong>
      {context.location && <Button size="small" type="link" icon={<AimOutlined />} onPointerDown={(event) => event.preventDefault()}
        onClick={() => onLocate(context.location!)}>定位谱面</Button>}
    </div>
    {!compact && <div className={styles.contextBottom}><p>{context.position}</p>{context.scope && <span>{context.scope}</span>}</div>}
    {context.reason && <p role="status">{context.reason}</p>}
    {context.differentSelection && context.location?.kind !== "lyric" && context.location?.kind !== "numbered" && <p>正在编辑原位置</p>}
    {context.differentSelection && context.location?.kind !== "lyric" && context.location?.kind !== "numbered" && onCurrentSelection && <Button size="small" type="link" onClick={onCurrentSelection}>切换到当前选区</Button>}
  </div>;
}
