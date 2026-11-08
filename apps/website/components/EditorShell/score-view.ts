import { A4_CONTENT_WIDTH } from "@liuxianmao/lxm-editor";

export type ScoreViewMode = "fit" | "actual";

export const SCORE_PAPER_WIDTH = 780;
export const SCORE_PAPER_PADDING = 42;
export const SCORE_PAPER_MIN_HEIGHT = 900;
export const SCORE_VIEW_GUTTER = 24;
export const SCORE_CONTENT_SCALE =
  (SCORE_PAPER_WIDTH - 2 * SCORE_PAPER_PADDING) / A4_CONTENT_WIDTH;

export interface ScoreViewGeometry {
  /** Fixed logical-unit to CSS-pixel ratio; independent of mode, viewport and DPR. */
  contentScale: number;
  svgWidth: number;
  svgHeight: number;
  baseWidth: number;
  baseHeight: number;
  scale: number;
  /** The stage occupies these dimensions, including the overflowing SVG. */
  width: number;
  height: number;
}

const positive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

export function calculateScoreView({
  layoutWidth,
  layoutHeight,
  viewportWidth,
  mode = "fit",
  gutter = SCORE_VIEW_GUTTER,
  visibleWidth = 0,
  visibleHeight = 0,
}: {
  layoutWidth: number;
  layoutHeight: number;
  /** clientWidth, after the vertical scrollbar, including CSS padding. */
  viewportWidth: number;
  mode?: ScoreViewMode;
  gutter?: number;
  /** Optional measured visual bounds, in unscaled CSS px, including padding. */
  visibleWidth?: number;
  visibleHeight?: number;
}): ScoreViewGeometry {
  const svgWidth = positive(layoutWidth, A4_CONTENT_WIDTH) * SCORE_CONTENT_SCALE;
  const svgHeight = positive(layoutHeight, 0) * SCORE_CONTENT_SCALE;
  const baseWidth = Math.max(
    SCORE_PAPER_WIDTH,
    2 * SCORE_PAPER_PADDING + svgWidth,
    positive(visibleWidth, 0),
  );
  const baseHeight = Math.max(
    SCORE_PAPER_MIN_HEIGHT,
    2 * SCORE_PAPER_PADDING + svgHeight,
    positive(visibleHeight, 0),
  );
  const availableWidth = viewportWidth - 2 * Math.max(0, positive(gutter, 0));
  // Hidden/unmeasured hosts must never create zero/negative transforms or NaN CTMs.
  const scale = mode === "fit" && Number.isFinite(availableWidth) && availableWidth > 0
    ? Math.min(1, availableWidth / baseWidth)
    : 1;
  return {
    contentScale: SCORE_CONTENT_SCALE,
    svgWidth,
    svgHeight,
    baseWidth,
    baseHeight,
    scale,
    width: baseWidth * scale,
    height: baseHeight * scale,
  };
}

export interface ScoreViewScroll {
  left: number;
  top: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ScoreViewAnchor {
  x: number;
  y: number;
}

/** Preserve the logical point at the visible center, including centered stage margins. */
export function captureScoreViewAnchor(
  geometry: ScoreViewGeometry,
  scroll: ScoreViewScroll,
  gutter = SCORE_VIEW_GUTTER,
  topInset = 30,
): ScoreViewAnchor {
  const stageLeft = Math.max(gutter, (scroll.viewportWidth - geometry.width) / 2);
  return {
    x: (scroll.left + scroll.viewportWidth / 2 - stageLeft) / geometry.scale,
    y: (scroll.top + scroll.viewportHeight / 2 - topInset) / geometry.scale,
  };
}

export function restoreScoreViewAnchor(
  anchor: ScoreViewAnchor,
  geometry: ScoreViewGeometry,
  viewport: Pick<ScoreViewScroll, "viewportWidth" | "viewportHeight">,
  gutter = SCORE_VIEW_GUTTER,
  topInset = 30,
): { left: number; top: number } {
  const stageLeft = Math.max(gutter, (viewport.viewportWidth - geometry.width) / 2);
  return {
    left: Math.max(0, stageLeft + anchor.x * geometry.scale - viewport.viewportWidth / 2),
    top: Math.max(0, topInset + anchor.y * geometry.scale - viewport.viewportHeight / 2),
  };
}

export function isScoreViewGeometryEqual(a: ScoreViewGeometry, b: ScoreViewGeometry) {
  return a.scale === b.scale && a.baseWidth === b.baseWidth && a.baseHeight === b.baseHeight;
}
