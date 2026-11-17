"use client";
import { Button, Popover } from "antd";
import { DownOutlined } from "@ant-design/icons";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type ReactElement,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { TOOL_GROUPS, type ToolGroupId } from "./editor-tool-catalog";
import editorFormStyles from "../shared/editor-form.module.scss";
import editorToolPanelStyles from "../shared/editor-tool-panel.module.scss";
import { EditorToolSymbolButton, TechniqueSymbol } from "./EditorToolSymbolButton";
import type { TechniqueIntent } from "./editor-technique-target";
import toolbarStyles from "../workspace/EditorToolbar.module.scss";

export interface EditorToolPanelController {
  open: (group: ToolGroupId, focusSelector?: string) => void;
  close: (restore?: boolean) => void;
  restore: (group: ToolGroupId) => void;
  openTechnique: (intent: TechniqueIntent) => boolean;
}
/** One viewport-positioned portal, bounded by the editor host. Rhythm previews exist only while open. */
export const EditorToolPanelHost = ({
  ref,
  children,
  beforeOpen,
  blocked,
  reason,
  canHide,
  subscribeProtection,
  onTechniqueIntent,
  onHideTechnique,
  beatTargetIdentity,
  getBeatTargetIdentity,
}: {
  ref: Ref<EditorToolPanelController>;
  children: Record<ToolGroupId, ReactNode>;
  beforeOpen: (group: ToolGroupId) => void;
  blocked: boolean;
  reason: string | null;
  canHide?: () => boolean;
  subscribeProtection?: (listener: () => void) => () => void;
  onTechniqueIntent?: (intent: TechniqueIntent) => boolean;
  onHideTechnique?: () => void;
  beatTargetIdentity?: string | null;
  getBeatTargetIdentity?: () => string | null;
}) => {
  const [group, setGroup] = useState<ToolGroupId>("measure");
  const clientReady = useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot);
  const [open, setOpen] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
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
  const currentOverlay = useRef({ open, group });
  useLayoutEffect(() => { currentOverlay.current = { open, group }; }, [open, group]);
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
    const button = trigger.current?.querySelector<HTMLButtonElement>(
      `[data-tool-trigger="${target}"]`,
    );
    return button?.getClientRects().length ? button : trigger.current?.querySelector<HTMLButtonElement>('[data-tool-trigger="more"]');
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
    const anchor = visibleTrigger(group)?.getBoundingClientRect();
    if (!editor || !anchor) return;
    const bounds = editor.getBoundingClientRect();
    const width = Math.min(group === "beat" && !moreMenu ? 724 : (group === "measure" ? 262 : group === "tuplet" ? 300 : 360) + 32,
      Math.max(0, bounds.width - 16), window.innerWidth - 16);
    const minLeft = Math.max(8, bounds.left + 8);
    const maxRight = Math.min(window.innerWidth - 8, bounds.right - 8);
    const left = Math.max(minLeft, Math.min(anchor.left, maxRight - width));
    const top = Math.min(anchor.bottom + 6, Math.max(8, window.innerHeight - 120));
    setGeometry({ left, top, width, maxHeight: Math.min(660, Math.max(80, window.innerHeight - top - 8)),
      more: !trigger.current?.querySelector('[data-tool-trigger="beat"]')?.getClientRects().length });
  };
  const show = (target: ToolGroupId, focusSelector?: string) => {
    if (blocked) return;
    if (target !== group && !canClose()) return;
    invalidateOutside();
    pendingClose.current = null;
    if (open && group === "technique" && target !== group && !moreMenu) onHideTechnique?.();
    requestedFocus.current = focusSelector ?? (target === "beat" ? '[data-rhythm-template][aria-pressed="true"]' : undefined);
    beforeOpen(target);
    setGroup(target);
    setMoreMenu(false);
    setOpen(true);
  };
  useImperativeHandle(ref, () => ({ open: show, close, restore,
    openTechnique: (intent) => !blocked && (onTechniqueIntent?.(intent) ?? false),
  }));
  useEffect(() => subscribeProtection?.(() => {
    if (pendingClose.current !== null && canClose()) close(pendingClose.current);
  }));
  useEffect(() => {
    if (pendingClose.current !== null && canClose()) close(pendingClose.current);
  });
  useEffect(() => {
    if (!blocked || !open) return;
    const frame = requestAnimationFrame(() => close());
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, open]);
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
  }, [group, moreMenu]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (group === "beat" || blocked || !(event.target instanceof Node) || trigger.current?.contains(event.target) || content.current?.contains(event.target)) return;
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
        if (requestedFocus.current)
          panel?.querySelector<HTMLElement>(requestedFocus.current)?.focus({ preventScroll: true });
        else
          panel
            ?.querySelector<HTMLElement>("button:not(:disabled),input")
            ?.focus({ preventScroll: true });
        requestedFocus.current = undefined;
      });
      return () => cancelAnimationFrame(frame);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group, moreMenu]);
  const popup = (
        <div
          ref={content}
          className={group === "beat" ? undefined : `ant-popover ${toolbarStyles.popup}`}
          role="dialog" aria-label={moreMenu ? "更多工具" : `${TOOL_GROUPS.find((item) => item.id === group)!.label}工具参数`}
          hidden={!open}
          style={group === "beat" ? undefined : { position: "fixed", left: geometry.left, top: geometry.top, width: geometry.width, display: open ? "block" : "none" }}
          inert={!open || blocked}
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
          <div className={`${editorToolPanelStyles.toolPanelHost} ${toolbarStyles.popupContent}`} style={{ maxHeight: geometry.maxHeight, ...(group === "beat" && !moreMenu ? { padding: 0 } : {}) }}>
          {(moreMenu || group !== "beat") && <h3>{moreMenu ? "更多工具" : `${TOOL_GROUPS.find((item) => item.id === group)!.label}工具`}</h3>}
          {moreMenu && <div className={editorToolPanelStyles.toolMenu}>
            {TOOL_GROUPS.filter((item) => item.id !== "technique").map((item) =>
              <Button key={item.id} block onClick={() => show(item.id)}>{item.label}工具</Button>)}
          </div>}
          {reason && (moreMenu || group !== "beat") && (
            <p role="status" data-editor-form-hint className={editorFormStyles.settingsHint}>
              {reason}
            </p>
          )}
          {TOOL_GROUPS.map((item) => (
            <div
              key={item.id}
              data-tool-panel={item.id}
              hidden={moreMenu || group !== item.id}
              inert={moreMenu || group !== item.id}
            >
              {item.id === "beat" ? open && group === "beat" && !moreMenu ? children.beat : null : children[item.id]}
            </div>
          ))}
          </div>
        </div>
  );
  const rhythmPopover = (anchor: ReactElement, more = false) => (
      <Popover
        trigger="click" open={open && group === "beat" && geometry.more === more}
        placement="bottomLeft" arrow={false} fresh
        getPopupContainer={() => portalRoot ?? window.document.body}
        styles={{ root: { width: geometry.width, maxWidth: "calc(100vw - 16px)" }, container: { padding: 0 } }}
        content={group === "beat" && geometry.more === more ? popup : null}
        onOpenChange={(next) => {
          if (next || group !== "beat" || !open) return;
          // 外部点击由 Popover 检测。等本次谱面点击/拖动完成后，选区切换保留面板，空白点击关闭。
          const previous = paintedBeatTarget.current;
          const deadline = performance.now() + 1500;
          invalidateOutside();
          const generation = outsideGeneration.current;
          const finish = () => {
            // mousedown安排的关闭只属于当次beat浮层；click切组/关闭重开后不可沿用。
            if (generation !== outsideGeneration.current || !currentOverlay.current.open || currentOverlay.current.group !== "beat") return;
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
  return (
    <>
      {clientReady && portalRoot && group !== "beat" && createPortal(popup, portalRoot)}
      <div
        ref={trigger}
        className={toolbarStyles.triggers}
        role="group"
        aria-label="小节、节奏型、连音与技巧"
        onKeyDownCapture={(event) => {
          if (open && event.key === "Escape" && !event.nativeEvent.isComposing && canClose()) {
            event.stopPropagation(); close(true);
          }
        }}
      >
        {[...TOOL_GROUPS.filter((item) => item.id === "technique"), ...TOOL_GROUPS.filter((item) => item.id !== "technique")].map((item) => item.id === "technique" ? (
          <EditorToolSymbolButton key={item.id} triggerId={item.id} label="技巧工具" title="全部 16 类吉他技巧"
            popup expanded={open && group === item.id} availability={{ enabled: !blocked, reason: blocked ? "请先完成当前弹层操作。" : "" }}
            onClick={() => { if (open && group === item.id) close(true); else show(item.id); }}>
            <TechniqueSymbol kind="technique" />
          </EditorToolSymbolButton>
        ) : (
          <span key={item.id} className={toolbarStyles.desktopTrigger}>{(() => {
            const button = <Button
            key={item.id}
            data-tool-trigger={item.id}
            disabled={blocked}
            aria-label={`${item.label}工具`}
            aria-expanded={open && group === item.id}
            aria-haspopup="dialog"
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
          </Button>;
            return item.id === "beat" ? rhythmPopover(button) : button;
          })()}</span>
        ))}
        <span className={toolbarStyles.moreTrigger}>{rhythmPopover(<Button data-tool-trigger="more" disabled={blocked}
          aria-label="更多工具" aria-haspopup="dialog" aria-expanded={open && (moreMenu || group !== "technique")}
          variant="text" onClick={(event) => {
            event.stopPropagation();
            if (open && moreMenu) close(true);
            else if (!blocked && canClose()) {
              invalidateOutside();
              pendingClose.current = null;
              if (open && group === "technique" && !moreMenu) onHideTechnique?.();
              setMoreMenu(true); setGroup("measure"); setOpen(true);
            }
          }}>更多<DownOutlined /></Button>, true)}</span>
      </div>
    </>
  );
};
const noopSubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
