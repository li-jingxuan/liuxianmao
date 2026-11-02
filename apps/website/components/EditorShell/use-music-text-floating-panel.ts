import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  computeFloatingPanelGeometry,
  FLOATING_PANEL_MARGIN,
  FLOATING_PANEL_MIN_WIDTH,
  type FloatingAnchorRect,
  type PopoverGeometry,
} from "./music-text-floating-position";

export interface MusicTextFloatingPanelOptions {
  open: boolean;
  targetKey: string;
  getAnchor: () => FloatingAnchorRect | null;
  getViewport: () => FloatingAnchorRect;
  /** IME、compositionend 保护及异步仲裁期间保留最后可见位置。 */
  freeze?: boolean;
  /** 谱面 viewport、侧栏等影响锚点或可用区域的容器。 */
  getObservedElements?: () => readonly (Element | null)[];
  /** 布局/缩放版本；也可在外部布局完成后调用 recompute。 */
  layoutKey?: unknown;
  revealTarget?: () => void;
}

const hiddenGeometry: PopoverGeometry = {
  kind: "hidden",
  reason: "layout-pending",
};
const sameGeometry = (a: PopoverGeometry, b: PopoverGeometry) => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "placed" && b.kind === "placed")
    return (
      a.left === b.left &&
      a.top === b.top &&
      a.placement === b.placement &&
      a.arrowOffset === b.arrowOffset
    );
  return a.kind !== "hidden" || (b.kind === "hidden" && a.reason === b.reason);
};

/** 只持有几何；不切表面、不改草稿。隐藏时保留 DOM，供下一轮测量。 */
export const useMusicTextFloatingPanel = (
  options: MusicTextFloatingPanelOptions,
) => {
  const {
    open,
    targetKey,
    getAnchor,
    getViewport,
    freeze = false,
    getObservedElements,
    layoutKey,
  } = options;
  const ref = useRef<HTMLElement>(null);
  const latest = useRef(options);
  const frame = useRef<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const observed = useRef(new Set<Element>());
  const geometryRef = useRef<PopoverGeometry>(hiddenGeometry);
  const [geometry, setGeometry] = useState<PopoverGeometry>(hiddenGeometry);

  const publish = useCallback((next: PopoverGeometry) => {
    if (sameGeometry(geometryRef.current, next)) return;
    geometryRef.current = next;
    setGeometry(next);
  }, []);
  const recompute = useCallback(() => {
    if (frame.current !== null || !latest.current.open) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const current = latest.current;
      if (!current.open) return;
      const panel = ref.current;
      // 同时观测父链，覆盖主布局/侧栏改变而未触发 window.resize 的情况。
      const elements = new Set<Element>();
      for (
        let element: Element | null = panel;
        element;
        element = element.parentElement
      )
        elements.add(element);
      for (const element of current.getObservedElements?.() ?? [])
        if (element) elements.add(element);
      for (const element of observed.current)
        if (!elements.has(element)) observer.current?.unobserve(element);
      for (const element of elements)
        if (!observed.current.has(element)) observer.current?.observe(element);
      observed.current = elements;

      if (current.freeze && geometryRef.current.kind === "placed") return;
      const anchor = current.getAnchor();
      const viewport = current.getViewport();
      if (!panel) {
        publish(hiddenGeometry);
        return;
      }
      const availableWidth =
        viewport.right - viewport.left - FLOATING_PANEL_MARGIN * 2;
      // 宽度在本轮内固定；不限制高度，否则会误把截断后的内容判为可操作。
      const maxWidth = Math.max(FLOATING_PANEL_MIN_WIDTH, availableWidth);
      const normalMaxWidth = `${maxWidth}px`;
      if (panel.style.maxWidth !== normalMaxWidth)
        panel.style.maxWidth = normalMaxWidth;
      panel.style.removeProperty("max-height");
      let rect = panel.getBoundingClientRect();
      let next = computeFloatingPanelGeometry(anchor, rect, viewport);
      if (
        next.kind === "sidebar-required" &&
        rect.width > FLOATING_PANEL_MIN_WIDTH &&
        availableWidth >= FLOATING_PANEL_MIN_WIDTH
      ) {
        // 卡片缩到最小操作宽度后再实测一次，尤其为左右候选留出空间。
        panel.style.maxWidth = `${FLOATING_PANEL_MIN_WIDTH}px`;
        rect = panel.getBoundingClientRect();
        next = computeFloatingPanelGeometry(anchor, rect, viewport);
      }
      publish(next);
    });
  }, [publish]);

  useLayoutEffect(() => {
    latest.current = options;
  });
  useLayoutEffect(() => {
    if (!open) {
      publish(hiddenGeometry);
      ref.current?.style.removeProperty("max-width");
      ref.current?.style.removeProperty("max-height");
      return;
    }
    observer.current =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(recompute);
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", recompute);
    visualViewport?.addEventListener("scroll", recompute);
    recompute();
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
      observer.current?.disconnect();
      observer.current = null;
      observed.current.clear();
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
      visualViewport?.removeEventListener("resize", recompute);
      visualViewport?.removeEventListener("scroll", recompute);
    };
  }, [open, publish, recompute]);
  useLayoutEffect(() => {
    if (open) recompute();
  }, [
    open,
    targetKey,
    getAnchor,
    getViewport,
    getObservedElements,
    layoutKey,
    freeze,
    recompute,
  ]);

  return {
    ref,
    geometry,
    recompute,
    // 旧 owner 的焦点恢复调用可继续使用；展示应改读 geometry。
    position:
      geometry.kind === "placed"
        ? { left: geometry.left, top: geometry.top }
        : { left: 0, top: 0 },
    offscreen: geometry.kind === "hidden" && geometry.reason === "offscreen",
    returnToTarget: () => {
      latest.current.revealTarget?.();
      recompute();
    },
  };
};
