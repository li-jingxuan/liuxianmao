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

/** 将编辑浮窗放在目标附近，并保证整个窗口留在 PC 可视区域内。 */
export const placeFloatingPanel = (
  anchor: FloatingAnchorRect,
  panel: FloatingPanelSize,
  viewport: { width: number; height: number; left?: number; top?: number },
  gap = 12,
): FloatingPanelPosition => {
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
