"use client";
import { Button, Popover, Tooltip } from "antd";
import { DownOutlined } from "@ant-design/icons";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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

export interface EditorToolPanelController {
  open: (group: ToolGroupId, focusSelector?: string) => void;
  close: (restore?: boolean) => void;
  prepareHide: () => boolean;
  restore: (group: ToolGroupId) => void;
  openTechnique: (intent: TechniqueIntent) => boolean;
}
/** One viewport-positioned portal, bounded by the editor host. */
export const EditorToolPanelHost = ({
  ref,
  children,
  quickTechniques,
  beforeOpen,
  blocked,
  preserveOnBlock,
  targetReasons,
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
  const activeTargetMissing = !moreMenu && !!targetReasons[group];
  const disabledReason = (target: ToolGroupId) => blocked ? "请先完成当前弹层操作。" : targetReasons[target];
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [geometry, setGeometry] = useState({ left: 8, top: 50, width: 300, maxHeight: 600, more: false });
  const trigger = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
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
  const close = (restoreTrigger = false) => {
    invalidateOutside();
    if (!canClose()) { pendingClose.current = restoreTrigger; return; }
    pendingClose.current = null;
    if (open && group === "technique" && !moreMenu) onHideTechnique?.();
    setOpen(false);
    if (restoreTrigger) {
      const target = group;
      restore(target);
      // Unmounting a portal may release its focused card after this synchronous call.
      requestAnimationFrame(() => restore(target));
    }
  };
  const align = () => {
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
  const show = (target: ToolGroupId, focusSelector?: string, fromMore = false) => {
    if (disabledReason(target)) return;
    if (target !== group && !canClose()) return;
    invalidateOutside();
    pendingClose.current = null;
    if (open && group === "technique" && target !== group && !moreMenu) onHideTechnique?.();
    requestedFocus.current = focusSelector;
    beforeOpen(target);
    setGroup(target);
    setMoreMenu(false);
    setAnchorInMore(fromMore);
    setOpen(true);
  };
  useImperativeHandle(ref, () => ({ open: show, close, restore,
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
  }, [group, moreMenu, anchorInMore]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (group === "beat" || blocked || !(event.target instanceof Node) || content.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-open-shortcuts],[data-playback-toggle]")) return;
      const button = event.target instanceof Element && event.target.closest("[data-tool-trigger]");
      if (button && trigger.current?.contains(button)) return;
      close();
    };
    if (group !== "beat") window.document.addEventListener("pointerdown", outside, true);
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
    if (open) {
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
  }, [open, group, moreMenu, anchorInMore]);
  const handleCompositionEnd = () => {
    composing.current = false;
    compositionBuffer.current = true;
    compositionFrame.current = requestAnimationFrame(() => {
      compositionBuffer.current = false;
      compositionFrame.current = null;
      if (pendingClose.current !== null) close(pendingClose.current);
    });
  };
  const handlePopupKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
  };
  const openMoreItem = (target: ToolGroupId) => () => show(target, undefined, true);
  const popup = (rhythm: boolean) => (
        <div
          ref={rhythm === (group === "beat") ? content : undefined}
          role="dialog" aria-label={moreMenu ? "更多工具" : `${TOOL_GROUPS.find((item) => item.id === group)!.label}工具参数`}
          hidden={!open || rhythm !== (group === "beat")}
          inert={!open || blocked || rhythm !== (group === "beat")}
          onCompositionStart={() => {
            composing.current = true;
            compositionBuffer.current = false;
          }}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={(event) => {
            // Portals bubble through the editor tree; keep score shortcuts inside this tool.
            if (group === "beat" && !moreMenu) {
              event.stopPropagation();
              if (/^[0-9]$/.test(event.key) || event.key === "Delete" || event.key === "Backspace") event.preventDefault();
            }
          }}
          onKeyDownCapture={handlePopupKeyDownCapture}
        >
          <div className={`${editorToolPanelStyles.toolPanelHost} ${toolbarStyles.popupContent}`} style={{ maxHeight: geometry.maxHeight, ...(group === "beat" && !moreMenu ? { padding: 0, "--rhythm-panel-max-height": `${geometry.maxHeight}px` } : {}) } as CSSProperties}>
          {moreMenu && <h3>更多工具</h3>}
          {moreMenu && <div className={editorToolPanelStyles.toolMenu}>
            {TOOL_GROUPS.filter((item) => item.id !== "technique").map((item) =>
              <Button key={item.id} block disabled={!!disabledReason(item.id)} title={disabledReason(item.id) ?? undefined}
                onClick={openMoreItem(item.id)}>{item.label}工具</Button>)}
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
          if (next || group !== "beat" || !open || preserveOnBlock) return;
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
    const active = open && group === id;
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
            popup expanded={open && group === "technique"} availability={{ enabled: !disabledReason("technique"), reason: disabledReason("technique") ?? "" }}
            onClick={() => { if (open && group === "technique") close(true); else show("technique"); }}>
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
