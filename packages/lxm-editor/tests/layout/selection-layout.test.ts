import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_4 from "../../example/example-mvp4.json";
import { resolveTabCellSelection } from "../../src/editing/tab-cell-selection";
import { buildLayout } from "../../src/layout";
import { getBeatCellBounds } from "../../src/layout/beat-cell-bounds";
import {
  LXM_TAB_FOCUS_CARET_HEIGHT,
  LXM_TAB_FOCUS_CARET_WIDTH,
} from "../../src/layout/layout-constants";
import {
  layoutTabCellCaret,
  layoutTabCellSelection,
} from "../../src/layout/selection-layout";

const cell = (measure: number, beat: number, string: number) => ({
  trackId: "mvp2-track-guitar",
  measureId: `mvp2-measure-${measure}`,
  beatId: `mvp2-beat-${measure}-${beat}`,
  string,
});

const resolve = (
  anchor: ReturnType<typeof cell>,
  focus: ReturnType<typeof cell>,
) => {
  const result = resolveTabCellSelection(EXAMPLE_MVP_4, { anchor, focus });
  if (!result.ok) throw new Error(result.message);
  return result.range;
};

describe("selection layout", () => {
  it("单格矩形以 Beat/string 锚点为中心使用固定 20 × 14 尺寸", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, {
      systemWidth: 733,
      density: "compact",
    });
    const measure = layout.systems[0]!.measures[0]!;
    const beat = measure.beats[0]!;
    const strings = measure.strings;
    const rects = layoutTabCellSelection(
      layout,
      resolve(cell(1, 1, 3), cell(1, 1, 3)),
    );

    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({
      measureId: measure.id,
      beatIds: [beat.id],
      x: beat.x - 10,
      width: 20,
      y: strings[2]!.y1 - 7,
      height: 14,
    });
  });

  it("同 measure 的横向、纵向和二维范围保持一个矩形", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, { systemWidth: 733 });
    const cases = [
      resolve(cell(1, 1, 2), cell(1, 4, 2)),
      resolve(cell(1, 2, 1), cell(1, 2, 5)),
      resolve(cell(1, 2, 2), cell(1, 5, 4)),
    ];

    for (const range of cases)
      expect(layoutTabCellSelection(layout, range)).toHaveLength(1);
  });

  it("跨 measure 和 system 时按实际布局拆分", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, {
      systemWidth: 733,
      density: "compact",
    });
    const range = resolve(cell(1, 8, 2), cell(8, 1, 5));
    const rects = layoutTabCellSelection(layout, range);

    expect(rects.length).toBeGreaterThan(1);
    expect(new Set(rects.map((rect) => rect.measureId)).size).toBe(
      rects.length,
    );
    expect(new Set(rects.map((rect) => rect.systemIndex)).size).toBeGreaterThan(
      1,
    );
  });

  it("layout 重建后使用新坐标且不改变布局总尺寸", () => {
    const compact = buildLayout(EXAMPLE_MVP_4, {
      systemWidth: 733,
      density: "compact",
    });
    const comfortable = buildLayout(EXAMPLE_MVP_4, {
      systemWidth: 900,
      density: "comfortable",
    });
    const range = resolve(cell(1, 2, 2), cell(2, 2, 4));
    const compactSize = { width: compact.width, height: compact.height };
    const comfortableSize = {
      width: comfortable.width,
      height: comfortable.height,
    };

    const compactRects = layoutTabCellSelection(compact, range);
    const comfortableRects = layoutTabCellSelection(comfortable, range);
    expect(compactRects).not.toEqual(comfortableRects);
    expect({ width: compact.width, height: compact.height }).toEqual(
      compactSize,
    );
    expect({ width: comfortable.width, height: comfortable.height }).toEqual(
      comfortableSize,
    );
  });

  it("focus caret 使用原始 focus，而不是规范范围末端", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, { systemWidth: 733 });
    const focus = cell(1, 2, 4);
    const caret = layoutTabCellCaret(layout, focus);
    const measure = layout.systems[0]!.measures[0]!;
    const beat = measure.beats.find(
      (candidate) => candidate.id === focus.beatId,
    )!;
    const string = measure.strings.find(
      (candidate) => candidate.index === focus.string,
    )!;

    expect(caret).toMatchObject({
      beatId: focus.beatId,
      string: 4,
      x: beat.x - LXM_TAB_FOCUS_CARET_WIDTH / 2,
      y: string.y1 - LXM_TAB_FOCUS_CARET_HEIGHT / 2,
      width: LXM_TAB_FOCUS_CARET_WIDTH,
      height: LXM_TAB_FOCUS_CARET_HEIGHT,
    });
    expect(caret!.x + caret!.width / 2).toBe(beat.x);
    expect(caret!.y + caret!.height / 2).toBe(string.y1);
  });

  it("单格范围与 focus caret 使用完全相同的固定矩形", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, { systemWidth: 733 });
    const focus = cell(1, 3, 4);
    const rect = layoutTabCellSelection(layout, resolve(focus, focus))[0]!;
    const caret = layoutTabCellCaret(layout, focus)!;

    expect({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }).toEqual({
      x: caret.x,
      y: caret.y,
      width: caret.width,
      height: caret.height,
    });
  });

  it("单 Beat 多弦范围保持固定宽度，并完整包住首尾弦 caret", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, { systemWidth: 733 });
    const anchor = cell(1, 2, 2);
    const focus = cell(1, 2, 5);
    const rect = layoutTabCellSelection(layout, resolve(anchor, focus))[0]!;
    const measure = layout.systems[0]!.measures[0]!;
    const beat = measure.beats.find(
      (candidate) => candidate.id === focus.beatId,
    )!;
    const startString = measure.strings.find((string) => string.index === 2)!;
    const endString = measure.strings.find((string) => string.index === 5)!;

    expect(rect).toMatchObject({
      x: beat.x - LXM_TAB_FOCUS_CARET_WIDTH / 2,
      y: startString.y1 - LXM_TAB_FOCUS_CARET_HEIGHT / 2,
      width: LXM_TAB_FOCUS_CARET_WIDTH,
      height: endString.y1 - startString.y1 + LXM_TAB_FOCUS_CARET_HEIGHT,
    });
  });

  it("多 Beat 范围继续使用宽单元格边界，不被固定 caret 宽度截短", () => {
    const layout = buildLayout(EXAMPLE_MVP_4, { systemWidth: 733 });
    const range = resolve(cell(1, 2, 3), cell(1, 4, 3));
    const rect = layoutTabCellSelection(layout, range)[0]!;
    const measure = layout.systems[0]!.measures[0]!;
    const first = measure.beats.find(
      (beat) => beat.id === range.beats[0]!.beatId,
    )!;
    const last = measure.beats.find(
      (beat) => beat.id === range.beats.at(-1)!.beatId,
    )!;
    const firstBounds = getBeatCellBounds(measure, first.id)!;
    const lastBounds = getBeatCellBounds(measure, last.id)!;

    expect(rect.x).toBe(firstBounds.left);
    expect(rect.width).toBe(lastBounds.right - firstBounds.left);
  });

  it("compact 与 comfortable 下 caret 尺寸固定，只更新中心坐标", () => {
    expect(LXM_TAB_FOCUS_CARET_WIDTH).toBe(20);
    expect(LXM_TAB_FOCUS_CARET_HEIGHT).toBe(14);

    for (const density of ["compact", "comfortable"] as const) {
      const layout = buildLayout(EXAMPLE_MVP_4, { systemWidth: 733, density });
      const focus = cell(1, 3, 4);
      const caret = layoutTabCellCaret(layout, focus)!;
      const measure = layout.systems[0]!.measures[0]!;
      const beat = measure.beats.find(
        (candidate) => candidate.id === focus.beatId,
      )!;
      const string = measure.strings.find(
        (candidate) => candidate.index === focus.string,
      )!;

      expect(caret).toMatchObject({ width: 20, height: 14 });
      expect(caret.x + caret.width / 2).toBe(beat.x);
      expect(caret.y + caret.height / 2).toBe(string.y1);
    }
  });
});
