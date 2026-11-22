"use client";
import { Button, Popover, Tooltip } from "antd";
import { DownOutlined } from "@ant-design/icons";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type ReactElement,
  type Ref,
} from "react";
import { TOOL_GROUPS, type ToolGroupId } from "./editor-tool-catalog";
import editorToolPanelStyles from "../shared/editor-tool-panel.module.scss";
import { EditorToolSymbolButton, TechniqueSymbol } from "./EditorToolSymbolButton";
import { TupletSymbol } from "./TupletToolbar";
import { BarlineSymbol } from "./MeasureBoundary";
import type { TechniqueIntent } from "./editor-technique-target";
import toolbarStyles from "../workspace/EditorToolbar.module.scss";
import { contextPanelPosition } from "../score/context-panel-position";

export type ContextToolGroup = Extract<ToolGroupId, "measure" | "beat" | "technique">;

interface ContextToolEntry {
  anchor: HTMLElement;
  onClose: () => void;
}

export interface EditorToolPanelController {
  open: (group: ToolGroupId, focusSelector?: string) => void;
  openContextTool: (group: ContextToolGroup, anchor: HTMLElement, onClose: () => void) => boolean;
  closeContextTool: () => boolean;
  getContextToolDisabledReason: (group: ContextToolGroup) => string | null;
  close: (restore?: boolean) => void;
  prepareHide: () => boolean;
  restore: (group: ToolGroupId) => void;
  openTechnique: (intent: TechniqueIntent) => boolean;
}
/** 工具栏和谱面菜单共用面板实例，分别按工具栏按钮或菜单行定位。 */
export const EditorToolPanelHost = ({
  ref,
  children,
  quickTechniques,
  beforeOpen,
  blocked,
  preserveOnBlock,
  targetReasons,
  contextTechniqueReason,
  canHide,
  subscribeProtection,
  onTechniqueIntent,
  onHideTechnique,
  beatTargetIdentity,
  getBeatTargetIdentity,
}: {
  ref: Ref<EditorToolPanelController>;
  children: Record<ToolGroupId, ReactNode>;
  quickTechniques: ReactNode;
  beforeOpen: (group: ToolGroupId) => void;
  blocked: boolean;
  preserveOnBlock?: boolean;
  targetReasons: Record<ToolGroupId, string | null>;
  contextTechniqueReason: string | null;
  canHide?: () => boolean;
  subscribeProtection?: (listener: () => void) => () => void;
  onTechniqueIntent?: (intent: TechniqueIntent) => boolean;
  onHideTechnique?: () => void;
  beatTargetIdentity: string | null;
  getBeatTargetIdentity?: () => string | null;
}) => {
  const [group, setGroup] = useState<ToolGroupId>("measure");
  const [open, setOpen] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const [anchorInMore, setAnchorInMore] = useState(false);
  const [contextEntry, setContextEntry] = useState<ContextToolEntry | null>(null);
  const contextEntryRef = useRef<ContextToolEntry | null>(null);
  const targetReason = (target: ToolGroupId, fromContext: boolean) =>
    fromContext && target === "technique" ? contextTechniqueReason : targetReasons[target];
  const activeTargetMissing = !moreMenu && !!targetReason(group, !!contextEntry);
  const disabledReason = (target: ToolGroupId, fromContext = false) =>
    blocked ? "请先完成当前弹层操作。" : targetReason(target, fromContext);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [geometry, setGeometry] = useState({ left: 8, top: 50, width: 300, maxHeight: 600, more: false });
  const trigger = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
  const [contextContent, setContextContent] = useState<HTMLDivElement | null>(null);
  const attachContextContent = useCallback((node: HTMLDivElement | null) => {
    content.current = node;
    setContextContent(node);
  }, []);
  const requestedFocus = useRef<string | undefined>(undefined);
  const composing = useRef(false);
  const compositionBuffer = useRef(false);
  const pendingClose = useRef<boolean | null>(null);
  const compositionFrame = useRef<number | null>(null);
  const outsideFrame = useRef<number | null>(null);
  const outsideGeneration = useRef(0);
  const currentOverlay = useRef({ open, group, preserveOnBlock });
  useLayoutEffect(() => { currentOverlay.current = { open, group, preserveOnBlock }; }, [open, group, preserveOnBlock]);
  const invalidateOutside = () => {
    outsideGeneration.current++;
    if (outsideFrame.current !== null) cancelAnimationFrame(outsideFrame.current);
    outsideFrame.current = null;
  };
  const paintedBeatTarget = useRef(beatTargetIdentity);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { paintedBeatTarget.current = beatTargetIdentity; });
    return () => cancelAnimationFrame(frame);
  }, [beatTargetIdentity]);
  useEffect(() => {
    if ((!open || group !== "beat") && outsideFrame.current !== null) {
      cancelAnimationFrame(outsideFrame.current);
      outsideFrame.current = null;
    }
  }, [open, group]);
  const canClose = () => !composing.current && !compositionBuffer.current && (canHide?.() ?? true);
  const visibleTrigger = (target: ToolGroupId) => {
    const more = trigger.current?.querySelector<HTMLButtonElement>('[data-tool-trigger="more"]');
    if (target === group && anchorInMore && more?.getClientRects().length) return more;
    return trigger.current?.querySelector<HTMLButtonElement>(
      `[data-tool-trigger="${target}"]`,
    );
  };
  const restore = (target: ToolGroupId) =>
    visibleTrigger(target)?.focus({ preventScroll: true });
  const finishContextEntry = (restoreRow: boolean) => {
    const entry = contextEntryRef.current;
    if (!entry) return false;
    // 先清除本次入口，再通知父菜单更新展开状态，避免同一轮的关闭事件重复通知。
    contextEntryRef.current = null;
    setContextEntry(null);
    entry.onClose();
    if (restoreRow) {
      const focusRow = () => {
        if (!contextEntryRef.current && entry.anchor.isConnected) entry.anchor.focus({ preventScroll: true });
      };
      focusRow();
      // 弹层卸载或父菜单提交展开状态后，再确认焦点仍在原行。
      requestAnimationFrame(focusRow);
    }
    return true;
  };
  const close = (restoreTrigger = false) => {
    invalidateOutside();
    if (!canClose()) { pendingClose.current = restoreTrigger; return; }
    pendingClose.current = null;
    if (open && group === "technique" && !moreMenu) onHideTechnique?.();
    setOpen(false);
    if (!finishContextEntry(restoreTrigger) && restoreTrigger) {
      const target = group;
      restore(target);
      // Unmounting a portal may release its focused card after this synchronous call.
      requestAnimationFrame(() => restore(target));
    }
  };
  const getContextToolDisabledReason = (target: ContextToolGroup) =>
    disabledReason(target, true) ?? (canClose() ? null : "请先完成当前工具中的操作。");
  const align = () => {
    if (contextEntry) return;
    const editor = trigger.current?.closest<HTMLElement>("[data-layout]") ?? trigger.current?.closest<HTMLElement>('[role="toolbar"]');
    const button = visibleTrigger(group);
    const anchor = button?.getBoundingClientRect();
    if (!editor || !anchor) return;
    const bounds = editor.getBoundingClientRect();
    const width = Math.min(group === "beat" && !moreMenu ? 456 : group === "measure" ? 410 : group === "tuplet" ? 300 : 392,
      Math.max(0, bounds.width - 16), window.innerWidth - 16);
    const minLeft = Math.max(8, bounds.left + 8);
    const maxRight = Math.min(window.innerWidth - 8, bounds.right - 8);
    const left = Math.max(minLeft, Math.min(anchor.left, maxRight - width));
    const minimumRoom = group === "beat" && !moreMenu ? 230 : 120;
    const top = Math.min(anchor.bottom + 6, Math.max(8, window.innerHeight - minimumRoom));
    setGeometry({ left, top, width, maxHeight: Math.min(660, Math.max(80, window.innerHeight - top - 8)),
      more: button?.dataset.toolTrigger === "more" });
  };
  const show = (target: ToolGroupId, focusSelector?: string, fromMore = false, entry: ContextToolEntry | null = null) => {
    if (disabledReason(target, !!entry)) return false;
    if ((target !== group || contextEntryRef.current !== entry) && !canClose()) return false;
    // 入口切换仍受现有草稿保护。切换到工具栏或另一菜单行时，先结束旧行的展开状态。
    if (contextEntryRef.current !== entry) {
      finishContextEntry(false);
      contextEntryRef.current = entry;
      setContextEntry(entry);
    }
    invalidateOutside();
    pendingClose.current = null;
    if (open && group === "technique" && target !== group && !moreMenu) onHideTechnique?.();
    requestedFocus.current = focusSelector;
    beforeOpen(target);
    setGroup(target);
    setMoreMenu(false);
    setAnchorInMore(fromMore);
    setOpen(true);
    return true;
  };
  useImperativeHandle(ref, () => ({
    open: (target, focusSelector) => {
      const entry = contextEntryRef.current;
      // 技巧面板内展开参数只移动当前面板的焦点，不重新从工具栏打开。
      if (entry && open && group === target && focusSelector) {
        requestAnimationFrame(() => {
          if (contextEntryRef.current === entry) content.current?.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
        });
        return;
      }
      show(target, focusSelector);
    },
    openContextTool: (target, anchor, onClose) => {
      if (!anchor.isConnected || !anchor.closest("[data-score-context-menu]")) return false;
      return show(target, undefined, false, { anchor, onClose });
    },
    closeContextTool: () => {
      if (!contextEntryRef.current) return true;
      // 父菜单需要同步判断能否离开，受保护时保留当前入口，不安排延迟关闭。
      if (!canClose()) return false;
      close();
      return true;
    },
    getContextToolDisabledReason,
    close, restore,
    prepareHide: () => {
      if (!canClose()) return false;
      close();
      return true;
    },
    openTechnique: (intent) => !disabledReason("technique") && (onTechniqueIntent?.(intent) ?? false),
  }));
  useEffect(() => subscribeProtection?.(() => {
    if (pendingClose.current !== null && canClose()) close(pendingClose.current);
  }));
  useEffect(() => {
    if (pendingClose.current !== null && canClose()) close(pendingClose.current);
  });
  useEffect(() => {
    if (!open || (!activeTargetMissing && (!blocked || preserveOnBlock))) return;
    const frame = requestAnimationFrame(() => close());
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, open, preserveOnBlock, group, activeTargetMissing]);
  useEffect(() => () => {
    if (compositionFrame.current !== null) cancelAnimationFrame(compositionFrame.current);
    if (outsideFrame.current !== null) cancelAnimationFrame(outsideFrame.current);
    outsideGeneration.current++;
    // 工具栏卸载也要清除父菜单的展开状态。卸载时不再移动焦点或更新本组件状态。
    const entry = contextEntryRef.current;
    contextEntryRef.current = null;
    entry?.onClose();
  }, []);
  useEffect(() => {
    const root = trigger.current;
    if (!root) return;
    const editor = root.closest<HTMLElement>("[data-layout]") ?? root.closest<HTMLElement>('[role="toolbar"]');
    // 水平查看桌面画布或尺寸改变时，重新测量实际触发器。
    const observer = new ResizeObserver(() => align());
    observer.observe(root);
    if (editor) observer.observe(editor);
    const frame = requestAnimationFrame(() => { setPortalRoot(editor ?? window.document.body); align(); });
    const update = () => align();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
    // 浮层对齐只依赖活动组，参数 owner 不参与此 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, moreMenu, anchorInMore, contextEntry]);
  useLayoutEffect(() => {
    if (!contextEntry) return;
    const { anchor } = contextEntry;
    const menu = anchor.closest("[data-score-context-menu]");
    if (!menu) return;
    const update = () => {
      // 菜单行决定垂直起点，父菜单边缘决定水平起点。按实际内容高度重新定位，参数展开后也能保持在视口内。
      const width = Math.min(group === "beat" ? 456 : group === "measure" ? 410 : 392, window.innerWidth - 16);
      const maxHeight = Math.min(660, window.innerHeight - 16);
      const height = Math.min(contextContent?.getBoundingClientRect().height || maxHeight, maxHeight);
      const { left, top } = contextPanelPosition(anchor, width, height);
      setGeometry((previous) => previous.left === left && previous.top === top && previous.width === width &&
        previous.maxHeight === maxHeight && !previous.more ? previous : { left, top, width, maxHeight, more: false });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(menu);
    observer.observe(anchor);
    if (contextContent) observer.observe(contextContent);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [contextEntry, contextContent, group]);
  useEffect(() => {
    // 父菜单因选区变化等原因卸载时，不能继续显示失去锚点的面板。
    if (!contextEntry || contextEntry.anchor.isConnected) return;
    const frame = requestAnimationFrame(() => {
      if (contextEntryRef.current === contextEntry) close();
    });
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (group === "beat" || blocked || !(event.target instanceof Node) || content.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-open-shortcuts],[data-playback-toggle]")) return;
      const button = event.target instanceof Element && event.target.closest("[data-tool-trigger]");
      if (button && trigger.current?.contains(button)) return;
      close();
    };
    // 菜单入口由父菜单统一处理外部点击，确保点击菜单行时仍可切换，也避免草稿阻止关闭后再次安排关闭。
    if (group !== "beat" && !contextEntry) window.document.addEventListener("pointerdown", outside, true);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || blocked || content.current?.closest("[inert]")) return;
      if (content.current?.querySelector('[role="combobox"][aria-expanded="true"]')) return;
      event.stopPropagation();
      if (canClose()) { event.preventDefault(); close(true); }
    };
    window.document.addEventListener("keydown", escape, true);
    return () => {
      window.document.removeEventListener("pointerdown", outside, true);
      window.document.removeEventListener("keydown", escape, true);
    };
  });
  useEffect(() => {
    if (open && (!contextEntry || contextContent)) {
      const frame = requestAnimationFrame(() => {
        align();
        const panel = moreMenu ? content.current : content.current?.querySelector<HTMLElement>(`[data-tool-panel="${group}"]`);
        if (requestedFocus.current) {
          panel?.querySelector<HTMLElement>(requestedFocus.current)?.focus({ preventScroll: true });
        } else if (group === "beat" && !moreMenu) {
          const tab = panel?.querySelector<HTMLElement>('[data-rhythm-tab][aria-selected="true"]');
          const activePane = tab ? window.document.getElementById(tab.getAttribute("aria-controls") ?? "") : panel;
          const selected = activePane?.querySelector<HTMLElement>('[data-rhythm-template][aria-pressed="true"], [data-strum-template][aria-pressed="true"], [data-rhythm-measure-template][aria-pressed="true"]');
          const templateGroup = selected?.hasAttribute("data-strum-template") ? "strum"
            : selected?.hasAttribute("data-rhythm-measure-template") ? "measure" : "beat";
          const focus = selected
            ? selected.getClientRects().length ? selected : activePane?.querySelector<HTMLElement>(
              `[data-rhythm-toggle="${templateGroup}"]`,
            )
            : tab ?? Array.from(activePane?.querySelectorAll<HTMLElement>("[data-rhythm-template]") ?? []).find((card) => card.getClientRects().length);
          (focus ?? tab ?? panel?.querySelector<HTMLElement>("[data-rhythm-pattern-panel]"))?.focus({ preventScroll: true });
          focus?.scrollIntoView({ block: "nearest" });
        } else {
          panel
            ?.querySelector<HTMLElement>("button:not(:disabled),input")
            ?.focus({ preventScroll: true });
        }
        requestedFocus.current = undefined;
      });
      return () => cancelAnimationFrame(frame);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group, moreMenu, anchorInMore, contextEntry, contextContent]);
  const popup = (rhythm: boolean) => (
        <div
          ref={rhythm === (group === "beat") ? (contextEntry ? attachContextContent : content) : undefined}
          role="dialog" aria-label={moreMenu ? "更多工具" : `${TOOL_GROUPS.find((item) => item.id === group)!.label}工具参数`}
          data-score-context-panel={contextEntry && open && rhythm === (group === "beat") ? group : undefined}
          hidden={!open || rhythm !== (group === "beat")}
          inert={!open || blocked || rhythm !== (group === "beat")}
          onCompositionStart={() => {
            composing.current = true;
            compositionBuffer.current = false;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            compositionBuffer.current = true;
            compositionFrame.current = requestAnimationFrame(() => {
              compositionBuffer.current = false;
              compositionFrame.current = null;
              if (pendingClose.current !== null) close(pendingClose.current);
            });
          }}
          onKeyDown={(event) => {
            // Portals bubble through the editor tree; keep score shortcuts inside this tool.
            if (group === "beat" && !moreMenu) {
              event.stopPropagation();
              if (/^[0-9]$/.test(event.key) || event.key === "Delete" || event.key === "Backspace") event.preventDefault();
            }
          }}
          onKeyDownCapture={(event) => {
            const target = event.target as HTMLElement;
            const expandedControl = target.closest('[aria-expanded="true"], .ant-select-open');
            if (
              event.key === "Escape" &&
              !event.nativeEvent.isComposing &&
              !expandedControl &&
              canClose()
            ) {
              event.stopPropagation();
              close(true);
            }
          }}
        >
          <div className={`${editorToolPanelStyles.toolPanelHost} ${toolbarStyles.popupContent}`} style={{ maxHeight: geometry.maxHeight, ...(group === "beat" && !moreMenu ? { padding: 0, "--rhythm-panel-max-height": `${geometry.maxHeight}px` } : {}) } as CSSProperties}>
          {moreMenu && <h3>更多工具</h3>}
          {moreMenu && <div className={editorToolPanelStyles.toolMenu}>
            {TOOL_GROUPS.filter((item) => item.id !== "technique").map((item) =>
              <Button key={item.id} block disabled={!!disabledReason(item.id)} title={disabledReason(item.id) ?? undefined}
                onClick={() => show(item.id, undefined, true)}>{item.label}工具</Button>)}
          </div>}
          {TOOL_GROUPS.filter((item) => (item.id === "beat") === rhythm).map((item) => (
            <div
              key={item.id}
              data-tool-panel={item.id}
              hidden={moreMenu || group !== item.id}
              inert={moreMenu || group !== item.id}
            >
              {item.id === "technique" ? children[item.id] : open && group === item.id && !moreMenu ? children[item.id] : null}
            </div>
          ))}
          </div>
        </div>
  );
  const popupStyles = { root: {
    position: "fixed", left: geometry.left, top: geometry.top, right: "auto", bottom: "auto",
    width: geometry.width, maxWidth: "calc(100vw - 16px)",
  }, container: { padding: 0 } } as const;
  const rhythmPopover = (anchor: ReactElement, more = false) => (
      <Popover
        trigger="click" open={open && group === "beat" && !activeTargetMissing && geometry.more === more}
        placement="bottomLeft" arrow={false} fresh
        getPopupContainer={() => portalRoot ?? window.document.body}
        styles={popupStyles}
        content={group === "beat" && geometry.more === more ? popup(true) : null}
        onOpenChange={(next) => {
          if (next || group !== "beat" || !open || preserveOnBlock || contextEntryRef.current) return;
          // 外部点击由 Popover 检测。等本次谱面点击/拖动完成后，选区切换保留面板，空白点击关闭。
          const previous = paintedBeatTarget.current;
          const deadline = performance.now() + 1500;
          invalidateOutside();
          const generation = outsideGeneration.current;
          const finish = () => {
            // mousedown安排的关闭只属于当次beat浮层；click切组/关闭重开后不可沿用。
            if (generation !== outsideGeneration.current || !currentOverlay.current.open || currentOverlay.current.group !== "beat" || currentOverlay.current.preserveOnBlock) return;
            if (performance.now() < deadline && window.document.querySelector('svg[aria-label="六线谱编辑器"]:active')) {
              outsideFrame.current = requestAnimationFrame(finish);
              return;
            }
            outsideFrame.current = null;
            const target = getBeatTargetIdentity?.();
            if (target && target !== previous) return;
            close();
          };
          outsideFrame.current = requestAnimationFrame(finish);
        }}
      >
        {anchor}
      </Popover>
  );
  const renderTrigger = (id: Exclude<ToolGroupId, "technique">, symbol: ReactNode) => {
    const { label } = TOOL_GROUPS.find((item) => item.id === id)!;
    const reason = disabledReason(id);
    const active = open && !contextEntry && group === id;
    const button = (
      <Tooltip title={reason ?? (id === "beat" ? "节奏型" : `${label}工具`)} trigger={["hover", "focus"]}>
        <Button
          data-tool-trigger={id}
          disabled={!!reason}
          aria-description={reason ?? undefined}
          aria-label={`${label}工具`}
          aria-expanded={active}
          aria-haspopup="dialog"
          color={active ? "primary" : "default"}
          variant={active ? "filled" : "text"}
          onClick={(event) => {
            event.stopPropagation();
            if (active) close(true);
            else show(id);
          }}
        >
          {symbol}
        </Button>
      </Tooltip>
    );
    return <span className={toolbarStyles.panelTrigger}>{id === "beat" ? rhythmPopover(button) : button}</span>;
  };
  return (
    <Popover
      trigger={[]}
      open={!!portalRoot && open && group !== "beat"}
      placement="bottomLeft"
      arrow={false}
      fresh
      forceRender={!!portalRoot}
      getPopupContainer={() => portalRoot ?? window.document.body}
      styles={popupStyles}
      content={portalRoot ? popup(false) : null}
    >
      <div
        ref={trigger}
        className={toolbarStyles.triggers}
        onKeyDownCapture={(event) => {
          if (open && event.key === "Escape" && !event.nativeEvent.isComposing && canClose()) {
            event.stopPropagation(); close(true);
          }
        }}
      >
        <div className={toolbarStyles.toolbarGroup} role="group" aria-label="演奏技巧">
          {quickTechniques}
          <EditorToolSymbolButton triggerId="technique" label="所有技巧" title="所有技巧"
            popup expanded={open && !contextEntry && group === "technique"} availability={{ enabled: !disabledReason("technique"), reason: disabledReason("technique") ?? "" }}
            onClick={() => { if (open && !contextEntry && group === "technique") close(true); else show("technique"); }}>
            <TechniqueSymbol kind="technique" />
          </EditorToolSymbolButton>
        </div>
        <div className={toolbarStyles.toolbarGroup} role="group" aria-label="节奏与连音">
          {renderTrigger("beat", <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false"><path d="M7 17V6l13-3v11M7 9l13-3" /><ellipse cx="4.5" cy="17.5" rx="3" ry="2" fill="currentColor" stroke="none" /><ellipse cx="17.5" cy="14.5" rx="3" ry="2" fill="currentColor" stroke="none" /></svg>)}
          {renderTrigger("tuplet", <TupletSymbol actual={3} normal={2} />)}
        </div>
        <div className={toolbarStyles.toolbarGroup} role="group" aria-label="小节">
          {renderTrigger("measure", <BarlineSymbol value="final" />)}
        </div>
        <span className={toolbarStyles.moreTrigger}>{rhythmPopover(<Button data-tool-trigger="more" disabled={blocked}
          aria-label="更多工具" aria-haspopup="dialog" aria-expanded={open && anchorInMore}
          variant="text" onClick={(event) => {
            event.stopPropagation();
            if (open && moreMenu) close(true);
            else if (!blocked && canClose()) {
              finishContextEntry(false);
              invalidateOutside();
              pendingClose.current = null;
              if (open && group === "technique" && !moreMenu) onHideTechnique?.();
              setAnchorInMore(true); setMoreMenu(true); setGroup("measure"); setOpen(true);
            }
          }}>更多<DownOutlined /></Button>, true)}</span>
      </div>
    </Popover>
  );
};
