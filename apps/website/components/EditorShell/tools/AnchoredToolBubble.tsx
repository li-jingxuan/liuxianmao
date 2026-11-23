"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { contextPanelPosition, fitContextOverlay } from "../score/context-panel-position";
import styles from "./AnchoredToolBubble.module.scss";

/** 小气泡挂到页面浮层，避免被工具面板的滚动区域裁切；业务目标和提交仍由入口持有。 */
export const AnchoredToolBubble = ({ anchor, label, contextCopy = false, compactCentered = false, suspended = false, dismissOnOutside = true, className, onDismiss, children }: {
  anchor: HTMLElement | null;
  label: string;
  contextCopy?: boolean;
  compactCentered?: boolean;
  suspended?: boolean;
  dismissOnOutside?: boolean;
  className?: string;
  onDismiss: (restoreFocus: boolean) => boolean | void;
  children: ReactNode;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  useLayoutEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);

  useLayoutEffect(() => {
    const panel = root.current;
    if (!panel || !anchor || suspended) return;
    const escapeScope = contextCopy ? anchor.closest("[data-score-context-menu]") ?? anchor : anchor;
    const place = () => {
      if (!anchor.isConnected || !anchor.getClientRects().length || anchor.closest("[inert]")) {
        panel.style.visibility = "hidden";
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const { offsetWidth: width, offsetHeight: height } = panel;
      const above = rect.bottom + 8 + height > window.innerHeight - 8;
      const { left, top } = contextCopy
        ? contextPanelPosition(anchor, width, height)
        : fitContextOverlay(compactCentered ? rect.left + (rect.width - width) / 2 : rect.left,
          above ? rect.top - height - 8 : rect.bottom + 8, width, height);
      const side = contextCopy ? left >= rect.right ? "right" : "left" : above ? "above" : "below";
      panel.dataset.side = side;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
      const x = side === "left" || side === "right" ? rect.top + rect.height / 2 - top : rect.left + rect.width / 2 - left;
      const length = contextCopy ? height : width;
      panel.style.setProperty("--bubble-arrow-offset", `${Math.max(10, Math.min(length - 10, x))}px`);
    };
    place();
    // 快捷键可能先准备方向，再由父工具面板完成定位。下一帧重新测量并让焦点进入选项。
    const frame = requestAnimationFrame(() => {
      place();
      const firstOption = panel.querySelector<HTMLElement>('[data-bubble-initial-focus]:not(:disabled), [aria-pressed="true"]')
        ?? panel.querySelector<HTMLElement>("button:not(:disabled)");
      (firstOption ?? (compactCentered ? panel : null))?.focus({ preventScroll: true });
    });
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    observer.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || panel.contains(target) || anchor.contains(target) || target.closest(".ant-modal-root")) return;
      dismiss.current(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || !(event.target instanceof Node) ||
        (!panel.contains(event.target) && !escapeScope.contains(event.target))) return;
      // 先关闭子气泡，再由下一次 Escape 交还父面板或右键菜单的焦点。
      if (dismiss.current(true) === false) return;
      event.preventDefault();
      event.stopPropagation();
    };
    if (dismissOnOutside) window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [anchor, compactCentered, contextCopy, dismissOnOutside, suspended]);

  if (!anchor) return null;
  return createPortal(<div ref={root} className={`${styles.bubble}${className ? ` ${className}` : ""}`} role="dialog" aria-label={label} hidden={suspended}
    tabIndex={compactCentered ? -1 : undefined} data-compact-centered={compactCentered || undefined}
    data-editor-anchored-tool data-score-context-panel={contextCopy ? "copy" : undefined}
    onKeyDown={(event) => event.stopPropagation()}>
    {children}
  </div>, window.document.body);
};
