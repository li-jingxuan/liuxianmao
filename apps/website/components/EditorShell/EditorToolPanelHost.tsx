"use client";
import { Button, Popover } from "antd";
import { DownOutlined } from "@ant-design/icons";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import type { TooltipRef } from "antd/es/tooltip";
import { TOOL_GROUPS, type ToolGroupId } from "./editor-tool-catalog";
import styles from "./index.module.scss";

export interface EditorToolPanelController {
  open: (group: ToolGroupId, focusSelector?: string) => void;
  close: (restore?: boolean) => void;
  restore: (group: ToolGroupId) => void;
}
/** 桌面工具共用同一个 Popover 和参数树，隐藏时保留参数草稿。 */
export const EditorToolPanelHost = ({
  ref,
  children,
  beforeOpen,
  blocked,
  reason,
}: {
  ref: Ref<EditorToolPanelController>;
  children: Record<ToolGroupId, ReactNode>;
  beforeOpen: () => void;
  blocked: boolean;
  reason: string | null;
}) => {
  const [group, setGroup] = useState<ToolGroupId>("measure");
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const trigger = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
  const popover = useRef<TooltipRef>(null);
  const requestedFocus = useRef<string | undefined>(undefined);
  const composing = useRef(false);
  const visibleTrigger = (target: ToolGroupId) =>
    trigger.current?.querySelector<HTMLButtonElement>(
      `[data-tool-trigger="${target}"]`,
    );
  const restore = (target: ToolGroupId) =>
    visibleTrigger(target)?.focus({ preventScroll: true });
  const close = (restoreTrigger = false) => {
    composing.current = false;
    setOpen(false);
    if (restoreTrigger) restore(group);
  };
  const align = () => {
    const anchor = visibleTrigger(group),
      container = trigger.current;
    if (anchor && container)
      setOffset(
        anchor.getBoundingClientRect().left -
          container.getBoundingClientRect().left,
      );
    popover.current?.forceAlign();
  };
  const show = (target: ToolGroupId, focusSelector?: string) => {
    if (blocked) return;
    requestedFocus.current = focusSelector;
    beforeOpen();
    setGroup(target);
    setOpen(true);
  };
  useImperativeHandle(ref, () => ({ open: show, close, restore }));
  useEffect(() => {
    const root = trigger.current;
    if (!root) return;
    // 水平查看桌面画布或尺寸改变时，重新测量实际触发器。
    const observer = new ResizeObserver(() => align());
    observer.observe(root);
    const update = () => align();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
    // 浮层对齐只依赖活动组，参数 owner 不参与此 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);
  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => {
        align();
        const panel = content.current?.querySelector<HTMLElement>(
          `[data-tool-panel="${group}"]`,
        );
        if (requestedFocus.current)
          panel?.querySelector<HTMLElement>(requestedFocus.current)?.focus();
        else
          panel
            ?.querySelector<HTMLElement>("button:not(:disabled),input")
            ?.focus();
        requestedFocus.current = undefined;
        popover.current?.forceAlign();
      });
      return () => cancelAnimationFrame(frame);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group]);
  if (blocked && open) setOpen(false);
  return (
    <Popover
      ref={popover}
      placement="bottomLeft"
      arrow={false}
      trigger="click"
      open={open && !blocked}
      destroyOnHidden={false}
      styles={{ container: { padding: 16 } }}
      align={{
        offset: [0, 0],
        // 移动目标锚点而非弹层偏移；后者会在视口平移后再次保留间距，造成边缘溢出。
        targetOffset: [-offset, -6],
        // 角落定位默认只翻转；低高度/页面缩放时还需平移，确保整个菜单留在视口内。
        overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true },
      }}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      content={
        <div
          ref={content}
          className={styles.toolPanelHost}
          style={{
            width: `min(${group === "measure" ? 262 : group === "beat" ? 313 : group === "tuplet" ? 300 : 360}px, calc(100vw - 64px))`,
          }}
          inert={!open || blocked}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              !event.nativeEvent.isComposing &&
              !composing.current
            ) {
              event.stopPropagation();
              close(true);
            }
          }}
        >
          <h3>{TOOL_GROUPS.find((item) => item.id === group)!.label}工具</h3>
          {reason && (
            <p role="status" className={styles.settingsHint}>
              {reason}
            </p>
          )}
          {TOOL_GROUPS.map((item) => (
            <div
              key={item.id}
              data-tool-panel={item.id}
              hidden={group !== item.id}
              inert={group !== item.id}
            >
              {children[item.id]}
            </div>
          ))}
        </div>
      }
    >
      <div
        ref={trigger}
        className={styles.advancedToolTriggers}
        role="group"
        aria-label="小节、拍点、连音与技巧"
      >
        {TOOL_GROUPS.map((item) => (
          <Button
            key={item.id}
            data-tool-trigger={item.id}
            disabled={blocked}
            aria-label={`${item.label}工具`}
            aria-expanded={open && group === item.id}
            color={open && group === item.id ? "primary" : "default"}
            variant={open && group === item.id ? "filled" : "text"}
            onClick={(event) => {
              event.stopPropagation();
              if (open && group === item.id) close(true);
              else show(item.id);
            }}
          >
            {item.label}
            <DownOutlined />
          </Button>
        ))}
      </div>
    </Popover>
  );
};
