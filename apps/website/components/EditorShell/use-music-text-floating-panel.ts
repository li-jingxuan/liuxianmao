import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import {
  clampFloatingPanel,
  placeFloatingPanel,
  type FloatingAnchorRect,
} from "./music-text-floating-position";

/** 只持有窗口几何；草稿和目标切换仍归编辑 owner 管理。 */
export const useMusicTextFloatingPanel = ({
  open,
  targetKey,
  getAnchor,
  getViewport,
  revealTarget,
}: {
  open: boolean;
  targetKey: string;
  getAnchor: () => FloatingAnchorRect | null;
  getViewport: () => FloatingAnchorRect;
  revealTarget: () => void;
}) => {
  const ref = useRef<HTMLElement>(null);
  const manual = useRef(false);
  const positionRef = useRef({ left: 24, top: 96 });
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const previousTarget = useRef("");
  const [position, setPosition] = useState({ left: 24, top: 96 });
  const [offscreen, setOffscreen] = useState(false);
  const update = (force = false) => {
    const panel = ref.current;
    if (!panel) return;
    const viewport = getViewport();
    const width = Math.max(1, viewport.right - viewport.left);
    const height = Math.max(1, viewport.bottom - viewport.top);
    // 限制实际窗口尺寸后再测量，展开高级区也不会把操作区挤出视口。
    panel.style.maxWidth = `${Math.max(1, width - 24)}px`;
    panel.style.maxHeight = `${Math.max(1, height - 24)}px`;
    const rect = panel.getBoundingClientRect();
    const anchor = getAnchor();
    setOffscreen(
      !!anchor &&
        (anchor.bottom < viewport.top ||
          anchor.top > viewport.bottom ||
          anchor.right < viewport.left ||
          anchor.left > viewport.right),
    );
    const bounds = {
      left: viewport.left + 12,
      top: viewport.top + 12,
      right: viewport.right - 12,
      bottom: viewport.bottom - 12,
    };
    const overlaps =
      !!anchor &&
      rect.left < anchor.right &&
      rect.right > anchor.left &&
      rect.top < anchor.bottom &&
      rect.bottom > anchor.top;
    const outside =
      rect.left < bounds.left ||
      rect.top < bounds.top ||
      rect.right > bounds.right ||
      rect.bottom > bounds.bottom;
    const changedTarget = previousTarget.current !== targetKey;
    const next =
      !manual.current &&
      anchor &&
      (force || changedTarget || overlaps || outside)
        ? placeFloatingPanel(anchor, rect, {
            left: viewport.left,
            top: viewport.top,
            width,
            height,
          })
        : clampFloatingPanel(positionRef.current, rect, bounds);
    previousTarget.current = targetKey;
    positionRef.current = next;
    setPosition((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    );
  };
  const latestUpdate = useRef(update);
  useLayoutEffect(() => {
    latestUpdate.current = update;
  });
  useLayoutEffect(() => {
    if (!open) {
      ref.current?.style.removeProperty("max-width");
      ref.current?.style.removeProperty("max-height");
      manual.current = false;
      previousTarget.current = "";
      return;
    }
    const refresh = () => latestUpdate.current();
    refresh();
    const observer = new ResizeObserver(refresh);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("scroll", refresh);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open) latestUpdate.current();
  }, [open, targetKey, getAnchor, getViewport]);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target as Element).closest("button, input, select, textarea")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    manual.current = true;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      ...positionRef.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !ref.current) return;
    event.stopPropagation();
    const viewport = getViewport();
    const next = clampFloatingPanel(
      {
        left: drag.current.left + event.clientX - drag.current.x,
        top: drag.current.top + event.clientY - drag.current.y,
      },
      ref.current.getBoundingClientRect(),
      {
        left: viewport.left + 12,
        top: viewport.top + 12,
        right: viewport.right - 12,
        bottom: viewport.bottom - 12,
      },
    );
    positionRef.current = next;
    setPosition(next);
  };
  return {
    ref,
    position,
    offscreen,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: () => {
        drag.current = null;
      },
      onLostPointerCapture: () => {
        drag.current = null;
      },
    },
    returnToTarget: () => {
      manual.current = false;
      revealTarget();
      requestAnimationFrame(() => latestUpdate.current(true));
    },
  };
};
