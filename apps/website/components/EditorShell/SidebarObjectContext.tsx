import { Button } from "antd";
import { AimOutlined } from "@ant-design/icons";
import type { SidebarContext, SidebarLocation } from "./sidebar-context";
import styles from "./SidebarFrame.module.scss";
export function SidebarObjectContext({ context, onLocate, onCurrentSelection }:
  { context: SidebarContext; onLocate: (location: SidebarLocation) => void; onCurrentSelection?: () => void }) {
  return <div className={styles.context} aria-label="当前编辑对象">
    <div className={styles.contextTop}>
      <strong>{context.title}</strong>
      {context.location && <Button size="small" type="link" icon={<AimOutlined />} onPointerDown={(event) => event.preventDefault()}
        onClick={() => onLocate(context.location!)}>定位谱面</Button>}
    </div>
    <div className={styles.contextBottom}><p>{context.position}</p>{context.scope && <span>{context.scope}</span>}</div>
    {context.reason && <p role="status">{context.reason}</p>}
    {context.differentSelection && <p>正在编辑原位置</p>}
    {context.differentSelection && onCurrentSelection && <Button size="small" type="link" onClick={onCurrentSelection}>切换到当前选区</Button>}
  </div>;
}
