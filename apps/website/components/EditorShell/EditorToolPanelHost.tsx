"use client";
import { Button, Empty, Input, Popover, Tabs } from "antd";
import { DownOutlined, SearchOutlined } from "@ant-design/icons";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import type { TooltipRef } from "antd/es/tooltip";
import {
  findEditorTools,
  TOOL_GROUPS,
  type ToolGroupId,
} from "./editor-tool-catalog";
import styles from "./index.module.scss";

export interface EditorToolPanelController {
  open: (group: ToolGroupId, focusSelector?: string) => void;
  close: (restore?: boolean) => void;
  restore: (group: ToolGroupId) => void;
}
/** 宽窄入口共用同一个 Popover 和参数树；容器 CSS 是断点的唯一事实来源。 */
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
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [compact, setCompact] = useState(false);
  const trigger = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
  const popover = useRef<TooltipRef>(null);
  const requestedFocus = useRef<string | undefined>(undefined);
  const composing = useRef(false);
  const lastComposition = useRef(-Infinity);
  const search = useRef<HTMLInputElement | null>(null);
  const mode = () =>
    !!trigger.current &&
    getComputedStyle(trigger.current)
      .getPropertyValue("--editor-tools-mode")
      .trim() === "compact";
  const visibleTrigger = (target: ToolGroupId) =>
    trigger.current?.querySelector<HTMLButtonElement>(
      mode() ? '[data-tool-trigger="more"]' : `[data-tool-trigger="${target}"]`,
    );
  const restore = (target: ToolGroupId) =>
    visibleTrigger(target)?.focus({ preventScroll: true });
  const close = (restoreTrigger = false) => {
    setOpen(false);
    if (restoreTrigger) restore(group);
  };
  const align = () => {
    setCompact(mode());
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
    setQuery("");
    setCompact(mode());
    setOpen(true);
  };
  useImperativeHandle(ref, () => ({ open: show, close, restore }));
  useEffect(() => {
    const root = trigger.current;
    if (!root) return;
    // 尺寸/滚动改变时重新测量实际触发器，不维护另一套 JS 断点阈值。
    const observer = new ResizeObserver(() => {
      const focused = document.activeElement;
      const wasTrigger =
        focused instanceof HTMLElement && root.contains(focused);
      align();
      if (
        wasTrigger &&
        focused instanceof HTMLElement &&
        focused.getClientRects().length === 0
      )
        restore(group);
    });
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
        else if (mode()) search.current?.focus();
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
  const results = findEditorTools(query);
  const locate = (target: ToolGroupId, actionId: string) => {
    setGroup(target);
    requestedFocus.current = `[data-tool-action="${actionId}"]`;
    requestAnimationFrame(() => {
      const panel = content.current?.querySelector<HTMLElement>(
        `[data-tool-panel="${target}"]`,
      );
      const action = panel?.querySelector<HTMLElement>(
        `[data-tool-action="${actionId}"]`,
      );
      if (action && !action.hasAttribute("disabled")) action.focus();
      else action?.parentElement?.focus();
    });
  };
  return (
    <Popover
      ref={popover}
      placement="bottomLeft"
      arrow={false}
      trigger="click"
      open={open && !blocked}
      destroyOnHidden={false}
      styles={{ container: { padding: 16 } }}
      align={{ offset: [offset, 6] }}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      content={
        <div
          ref={content}
          className={styles.toolPanelHost}
          style={{
            width: `min(${compact ? 313 : group === "measure" ? 262 : group === "beat" ? 313 : group === "tuplet" ? 300 : 360}px, calc(100vw - 64px))`,
          }}
          inert={!open || blocked}
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
          {compact && (
            <div className={styles.toolSearch}>
              <Input
                ref={(input) => {
                  search.current = input?.input ?? null;
                }}
                prefix={<SearchOutlined />}
                aria-label="搜索更多工具"
                placeholder="搜索小节、粘贴、技巧…"
                value={query}
                allowClear
                onChange={(event) => setQuery(event.target.value)}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                  lastComposition.current = Date.now();
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    !composing.current &&
                    Date.now() - lastComposition.current > 80 &&
                    results.length === 1
                  ) {
                    event.preventDefault();
                    locate(results[0]!.group, results[0]!.id);
                  }
                }}
              />
              {query.trim() &&
                (results.length ? (
                  <div className={styles.toolSearchResults}>
                    {results.map((item) => (
                      <Button
                        key={item.id}
                        type="text"
                        block
                        onClick={() => locate(item.group, item.id)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="没有匹配的工具"
                  >
                    <Button onClick={() => setQuery("")}>清空搜索</Button>
                  </Empty>
                ))}
              <Tabs
                activeKey={group}
                onChange={(key) => setGroup(key as ToolGroupId)}
                items={TOOL_GROUPS.map((item) => ({
                  key: item.id,
                  label: item.label,
                }))}
              />
            </div>
          )}
          {!compact && (
            <h3>{TOOL_GROUPS.find((item) => item.id === group)!.label}工具</h3>
          )}
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
            className={styles.wideToolTrigger}
            data-tool-trigger={item.id}
            disabled={blocked}
            aria-label={`${item.label}工具`}
            aria-expanded={open && !compact && group === item.id}
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
        <Button
          className={styles.compactToolTrigger}
          data-tool-trigger="more"
          disabled={blocked}
          aria-label="更多工具"
          aria-expanded={open && compact}
          onClick={(event) => {
            event.stopPropagation();
            if (open) close(true);
            else show(group);
          }}
        >
          更多工具
          <DownOutlined />
        </Button>
      </div>
    </Popover>
  );
};
