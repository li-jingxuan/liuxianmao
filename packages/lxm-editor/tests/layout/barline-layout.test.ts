import { describe, expect, it } from "vitest";

import {
  LXM_BARLINE_LINE_GAP,
  LXM_BARLINE_REPEAT_DOT_OFFSET_X,
  LXM_BARLINE_REPEAT_DOT_RADIUS,
  LXM_BARLINE_REPEAT_LOWER_DOT_OFFSET_Y,
  LXM_BARLINE_REPEAT_UPPER_DOT_OFFSET_Y,
  LXM_BARLINE_THICK_STROKE_WIDTH,
  LXM_BARLINE_THIN_STROKE_WIDTH,
} from "../../src/layout/layout-constants";
import { layoutBarline } from "../../src/layout/barline-layout";
import type { ILXMStringLineLayout } from "../../src/layout/layout-types";

const createUnsortedStrings = (): ILXMStringLineLayout[] => [
  { index: 6, x1: 10, y1: 90, x2: 210, y2: 90 },
  { index: 1, x1: 10, y1: 30, x2: 210, y2: 30 },
  { index: 3, x1: 10, y1: 54, x2: 210, y2: 54 },
];

describe("layoutBarline", () => {
  it("根据未排序弦线生成终止线的细线和粗线", () => {
    const layout = layoutBarline("final", createUnsortedStrings());

    expect(layout.type).toBe("final");
    expect(layout.parts).toEqual([
      {
        kind: "line",
        x: 210 - LXM_BARLINE_LINE_GAP,
        y1: 30,
        y2: 90,
        strokeWidth: LXM_BARLINE_THIN_STROKE_WIDTH,
      },
      {
        kind: "line",
        x: 210,
        y1: 30,
        y2: 90,
        strokeWidth: LXM_BARLINE_THICK_STROKE_WIDTH,
      },
    ]);
  });

  it("为结束反复线生成两个圆点和两根竖线", () => {
    const layout = layoutBarline("repeatEnd", createUnsortedStrings());

    expect(layout.parts).toEqual([
      {
        kind: "dot",
        cx: 210 - LXM_BARLINE_REPEAT_DOT_OFFSET_X,
        cy: 30 + LXM_BARLINE_REPEAT_UPPER_DOT_OFFSET_Y,
        radius: LXM_BARLINE_REPEAT_DOT_RADIUS,
      },
      {
        kind: "dot",
        cx: 210 - LXM_BARLINE_REPEAT_DOT_OFFSET_X,
        cy: 30 + LXM_BARLINE_REPEAT_LOWER_DOT_OFFSET_Y,
        radius: LXM_BARLINE_REPEAT_DOT_RADIUS,
      },
      {
        kind: "line",
        x: 210 - LXM_BARLINE_LINE_GAP,
        y1: 30,
        y2: 90,
        strokeWidth: LXM_BARLINE_THIN_STROKE_WIDTH,
      },
      {
        kind: "line",
        x: 210,
        y1: 30,
        y2: 90,
        strokeWidth: LXM_BARLINE_THICK_STROKE_WIDTH,
      },
    ]);
  });

  it("没有弦线时返回空 parts，避免布局调用方崩溃", () => {
    expect(layoutBarline("single", [])).toEqual({
      type: "single",
      parts: [],
    });
  });
});
