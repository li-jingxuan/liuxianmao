export interface FloatingAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FloatingPanelSize {
  width: number;
  height: number;
}

export interface FloatingPanelPosition {
  left: number;
  top: number;
}

export type FloatingPanelBounds = FloatingAnchorRect;

export type PopoverPlacement = "bottom" | "top" | "right" | "left";
export type PopoverGeometry =
  | ({
      kind: "placed";
      placement: PopoverPlacement;
      /** 箭头在卡片对应边上的坐标（相对 left 或 top）。 */
      arrowOffset: number;
    } & FloatingPanelPosition)
  | { kind: "hidden"; reason: "offscreen" | "layout-pending" }
  | { kind: "sidebar-required" };

export const FLOATING_PANEL_MARGIN = 12;
export const FLOATING_PANEL_GAP = 8;
export const FLOATING_PANEL_MIN_WIDTH = 280;
const ARROW_INSET = 16;
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
const validRect = (rect: FloatingAnchorRect) =>
  [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) &&
  rect.right > rect.left &&
  rect.bottom > rect.top;

/** 纯屏幕坐标计算；候选只沿箭头所在边平移，不把卡片推回选中框上。 */
export const computeFloatingPanelGeometry = (
  anchor: FloatingAnchorRect | null,
  panel: FloatingPanelSize,
  viewport: FloatingPanelBounds,
  gap = FLOATING_PANEL_GAP,
): PopoverGeometry => {
  if (!anchor || !validRect(anchor) || !validRect(viewport))
    return { kind: "hidden", reason: "layout-pending" };
  const visible = {
    left: Math.max(anchor.left, viewport.left),
    top: Math.max(anchor.top, viewport.top),
    right: Math.min(anchor.right, viewport.right),
    bottom: Math.min(anchor.bottom, viewport.bottom),
  };
  if (!validRect(visible)) return { kind: "hidden", reason: "offscreen" };
  const bounds = {
    left: viewport.left + FLOATING_PANEL_MARGIN,
    top: viewport.top + FLOATING_PANEL_MARGIN,
    right: viewport.right - FLOATING_PANEL_MARGIN,
    bottom: viewport.bottom - FLOATING_PANEL_MARGIN,
  };
  if (!validRect(bounds)) return { kind: "hidden", reason: "layout-pending" };
  if (
    !Number.isFinite(panel.width) ||
    !Number.isFinite(panel.height) ||
    panel.width <= 0 ||
    panel.height <= 0
  )
    return { kind: "hidden", reason: "layout-pending" };
  if (
    panel.width < FLOATING_PANEL_MIN_WIDTH ||
    panel.width > bounds.right - bounds.left ||
    panel.height > bounds.bottom - bounds.top
  )
    return { kind: "sidebar-required" };

  const centerX = (visible.left + visible.right) / 2;
  const centerY = (visible.top + visible.bottom) / 2;
  for (const placement of ["bottom", "top", "right", "left"] as const) {
    const horizontal = placement === "bottom" || placement === "top";
    const left = horizontal
      ? clamp(
          centerX - panel.width / 2,
          bounds.left,
          bounds.right - panel.width,
        )
      : placement === "right"
        ? anchor.right + gap
        : anchor.left - gap - panel.width;
    const top = horizontal
      ? placement === "bottom"
        ? anchor.bottom + gap
        : anchor.top - gap - panel.height
      : clamp(
          centerY - panel.height / 2,
          bounds.top,
          bounds.bottom - panel.height,
        );
    const right = left + panel.width;
    const bottom = top + panel.height;
    if (
      left < bounds.left ||
      top < bounds.top ||
      right > bounds.right ||
      bottom > bounds.bottom ||
      (left < anchor.right &&
        right > anchor.left &&
        top < anchor.bottom &&
        bottom > anchor.top)
    )
      continue;
    // 靠边时允许指向可见目标中的其他点，但不能让箭头指向目标之外。
    const start = horizontal ? left : top;
    const length = horizontal ? panel.width : panel.height;
    const min = Math.max(
      start + ARROW_INSET,
      horizontal ? visible.left : visible.top,
    );
    const max = Math.min(
      start + length - ARROW_INSET,
      horizontal ? visible.right : visible.bottom,
    );
    if (min > max) continue;
    return {
      kind: "placed",
      left,
      top,
      placement,
      arrowOffset: clamp(horizontal ? centerX : centerY, min, max) - start,
    };
  }
  return { kind: "sidebar-required" };
};

export const clampFloatingPanel = (
  position: FloatingPanelPosition,
  panel: FloatingPanelSize,
  bounds: FloatingPanelBounds,
): FloatingPanelPosition => ({
  left: Math.min(
    Math.max(position.left, bounds.left),
    Math.max(bounds.left, bounds.right - panel.width),
  ),
  top: Math.min(
    Math.max(position.top, bounds.top),
    Math.max(bounds.top, bounds.bottom - panel.height),
  ),
});

/** 兼容旧调用；新呈现必须使用 computeFloatingPanelGeometry 处理隐藏及侧栏降级。 */
export const placeFloatingPanel = (
  anchor: FloatingAnchorRect,
  panel: FloatingPanelSize,
  viewport: { width: number; height: number; left?: number; top?: number },
  gap = FLOATING_PANEL_GAP,
): FloatingPanelPosition => {
  const geometry = computeFloatingPanelGeometry(
    anchor,
    panel,
    {
      left: viewport.left ?? 0,
      top: viewport.top ?? 0,
      right: (viewport.left ?? 0) + viewport.width,
      bottom: (viewport.top ?? 0) + viewport.height,
    },
    gap,
  );
  if (geometry.kind === "placed")
    return { left: geometry.left, top: geometry.top };
  const margin = 12;
  const bounds = {
    left: (viewport.left ?? 0) + margin,
    top: (viewport.top ?? 0) + margin,
    right: (viewport.left ?? 0) + viewport.width - margin,
    bottom: (viewport.top ?? 0) + viewport.height - margin,
  };
  const below = anchor.bottom + gap;
  const above = anchor.top - panel.height - gap;
  const top =
    below + panel.height <= bounds.bottom
      ? below
      : above >= bounds.top
        ? above
        : below;
  return clampFloatingPanel({ left: anchor.left, top }, panel, bounds);
};
