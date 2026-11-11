import { describe, expect, it } from "vitest";
import { A4_CONTENT_WIDTH } from "@liuxianmao/lxm-editor";
import {
  calculateScoreView,
  captureScoreViewAnchor,
  restoreScoreViewAnchor,
  SCORE_CONTENT_SCALE,
} from "../components/EditorShell/score/score-view";

const standard = {
  layoutWidth: A4_CONTENT_WIDTH,
  layoutHeight: 1000,
  viewportWidth: 1000,
};

describe("screen score geometry", () => {
  it("keeps actual paper and logical-unit scale fixed across host widths", () => {
    for (const viewportWidth of [375, 768, 959, 960, 1199, 1200, 1599, 1600, 1920]) {
      const geometry = calculateScoreView({ ...standard, viewportWidth, mode: "actual" });
      expect(geometry.baseWidth).toBe(780);
      expect(geometry.svgWidth).toBe(696);
      expect(geometry.contentScale).toBe(696 / A4_CONTENT_WIDTH);
      expect(geometry.scale).toBe(1);
      expect(geometry.width).toBe(780);
      expect(geometry.height).toBeGreaterThanOrEqual(900);
    }
  });

  it("fits the entire oversized SVG with paper padding and never enlarges it", () => {
    const geometry = calculateScoreView({
      ...standard, layoutWidth: A4_CONTENT_WIDTH * 2, viewportWidth: 768,
    });
    expect(geometry.baseWidth).toBe(84 + 696 * 2);
    expect(geometry.scale).toBeCloseTo((768 - 48) / geometry.baseWidth);
    expect(geometry.width).toBeCloseTo(720);
    expect(geometry.height).toBeCloseTo(geometry.baseHeight * geometry.scale);
    expect(calculateScoreView({ ...standard, viewportWidth: 3000 }).scale).toBe(1);
  });

  it("includes tall or additionally measured visual bounds in the stage", () => {
    const geometry = calculateScoreView({
      ...standard, layoutHeight: 4000, visibleWidth: 1800, visibleHeight: 5000,
    });
    expect(geometry.baseWidth).toBe(1800);
    expect(geometry.baseHeight).toBe(5000);
    const tall = calculateScoreView({ ...standard, layoutHeight: 4000 });
    expect(tall.baseHeight).toBe(84 + 4000 * SCORE_CONTENT_SCALE);
    expect(calculateScoreView({ ...standard, layoutHeight: 10 }).baseHeight).toBe(900);
  });

  it("does not produce invalid transforms for hidden hosts or malformed dimensions", () => {
    for (const viewportWidth of [0, -100, 48, Number.NaN, Number.POSITIVE_INFINITY]) {
      const geometry = calculateScoreView({
        layoutWidth: Number.NaN, layoutHeight: -1, viewportWidth,
      });
      expect(geometry.scale).toBe(1);
      expect(geometry.baseWidth).toBe(780);
      expect(geometry.baseHeight).toBe(900);
    }
    const tiny = calculateScoreView({ ...standard, viewportWidth: 49 });
    expect(tiny.scale).toBeGreaterThan(0);
    expect(tiny.width).toBeCloseTo(1);
  });
});

describe("logical scroll anchor", () => {
  it("retains a later-page logical position when a panel reduces fit width", () => {
    const before = calculateScoreView({ ...standard, layoutHeight: 5000 });
    const scroll = { left: 0, top: 1600, viewportWidth: 1000, viewportHeight: 600 };
    const anchor = captureScoreViewAnchor(before, scroll);
    const after = calculateScoreView({ ...standard, layoutHeight: 5000, viewportWidth: 600 });
    const viewport = { viewportWidth: 600, viewportHeight: 600 };
    const position = restoreScoreViewAnchor(anchor, after, viewport);
    const restoredAnchor = captureScoreViewAnchor(after, { ...viewport, ...position });
    expect(restoredAnchor.x).toBeCloseTo(anchor.x);
    expect(restoredAnchor.y).toBeCloseTo(anchor.y);
    expect(position.top).toBeGreaterThan(0);
  });

  it("retains horizontal and vertical position when switching a wide layout to actual", () => {
    const input = { ...standard, layoutWidth: 2 * A4_CONTENT_WIDTH, layoutHeight: 5000, viewportWidth: 700 };
    const fit = calculateScoreView(input);
    const actual = calculateScoreView({ ...input, mode: "actual" });
    const viewport = { viewportWidth: 700, viewportHeight: 500 };
    const anchor = captureScoreViewAnchor(fit, { ...viewport, left: 0, top: 500 });
    const position = restoreScoreViewAnchor(anchor, actual, viewport);
    expect(position.left).toBeGreaterThan(0);
    const recovered = captureScoreViewAnchor(actual, { ...viewport, ...position });
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
