import { describe, expect, it } from "vitest";
import { A4_CONTENT_WIDTH } from "@liuxianmao/lxm-editor";
import {
  calculateScoreView,
  captureScoreViewAnchor,
  restoreScoreViewAnchor,
  SCORE_CONTENT_SCALE,
  SCORE_ZOOM_LEVELS,
} from "../components/EditorShell/score/score-view";

const standard = {
  layoutWidth: A4_CONTENT_WIDTH,
  layoutHeight: 1000,
};

describe("screen score geometry", () => {
  it("keeps internal paper and logical-unit scale fixed at all four zoom levels", () => {
    for (const zoom of SCORE_ZOOM_LEVELS) {
      const geometry = calculateScoreView({ ...standard, zoom });
      expect(geometry.baseWidth).toBe(780);
      expect(geometry.svgWidth).toBe(696);
      expect(geometry.contentScale).toBe(696 / A4_CONTENT_WIDTH);
      expect(geometry.scale).toBe(zoom / 100);
      expect(geometry.width).toBe(780 * zoom / 100);
      expect(geometry.height).toBe(geometry.baseHeight * zoom / 100);
    }
  });

  it("defaults to 125% and gives oversized SVGs their full physical scroll area", () => {
    const geometry = calculateScoreView({
      ...standard, layoutWidth: A4_CONTENT_WIDTH * 2,
    });
    expect(geometry.baseWidth).toBe(84 + 696 * 2);
    expect(geometry.scale).toBe(1.25);
    expect(geometry.width).toBeCloseTo(geometry.baseWidth * 1.25);
    expect(geometry.height).toBeCloseTo(geometry.baseHeight * geometry.scale);
    expect(calculateScoreView(standard).width).toBe(975);
  });

  it("includes tall or additionally measured visual bounds in the stage", () => {
    const geometry = calculateScoreView({
      ...standard, layoutHeight: 4000, visibleWidth: 1800, visibleHeight: 5000,
    });
    expect(geometry.baseWidth).toBe(1800);
    expect(geometry.baseHeight).toBe(5000);
    expect(geometry.width).toBe(2250);
    expect(geometry.height).toBe(6250);
    const tall = calculateScoreView({ ...standard, layoutHeight: 4000 });
    expect(tall.baseHeight).toBe(84 + 4000 * SCORE_CONTENT_SCALE);
    expect(calculateScoreView({ ...standard, layoutHeight: 10 }).baseHeight).toBe(900);
  });

  it("does not produce invalid transforms for malformed layout dimensions", () => {
    for (const layoutWidth of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const geometry = calculateScoreView({
        layoutWidth, layoutHeight: -1,
      });
      expect(geometry.scale).toBe(1.25);
      expect(geometry.baseWidth).toBe(780);
      expect(geometry.baseHeight).toBe(900);
    }
  });
});

describe("logical scroll anchor", () => {
  it("retains a later-page logical position when a panel reduces viewport width", () => {
    const before = calculateScoreView({ ...standard, layoutHeight: 5000 });
    const scroll = { left: 0, top: 1600, viewportWidth: 1000, viewportHeight: 600 };
    const anchor = captureScoreViewAnchor(before, scroll);
    const after = calculateScoreView({ ...standard, layoutHeight: 5000 });
    const viewport = { viewportWidth: 600, viewportHeight: 600 };
    const position = restoreScoreViewAnchor(anchor, after, viewport);
    const restoredAnchor = captureScoreViewAnchor(after, { ...viewport, ...position });
    expect(restoredAnchor.x).toBeCloseTo(anchor.x);
    expect(restoredAnchor.y).toBeCloseTo(anchor.y);
    expect(position.top).toBeGreaterThan(0);
  });

  it.each(SCORE_ZOOM_LEVELS)("retains horizontal and vertical center when zooming to %i%%", (zoom) => {
    const input = { ...standard, layoutWidth: 2 * A4_CONTENT_WIDTH, layoutHeight: 5000 };
    const before = calculateScoreView({ ...input, zoom: 100 });
    const after = calculateScoreView({ ...input, zoom });
    const viewport = { viewportWidth: 700, viewportHeight: 500 };
    const anchor = captureScoreViewAnchor(before, { ...viewport, left: 100, top: 500 });
    const position = restoreScoreViewAnchor(anchor, after, viewport);
    expect(position.left).toBeGreaterThan(0);
    const recovered = captureScoreViewAnchor(after, { ...viewport, ...position });
    expect(recovered.x).toBeCloseTo(anchor.x);
    expect(recovered.y).toBeCloseTo(anchor.y);
  });

  it("clamps scroll offsets at the document start", () => {
    const geometry = calculateScoreView(standard);
    expect(restoreScoreViewAnchor({ x: 0, y: 0 }, geometry, {
      viewportWidth: 1000, viewportHeight: 600,
    })).toEqual({ left: 0, top: 0 });
  });
});
