import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_4 from "../../example/example-mvp4.json";
import { resolveTabCellSelection } from "../../src/editing/tab-cell-selection";
import { buildLayout } from "../../src/layout";
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
  it("单格矩形完整使用最终 beat slot 和目标弦单元格", () => {
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
      x: beat.x,
      width: beat.width,
      y: (strings[1]!.y1 + strings[2]!.y1) / 2,
      height: strings[3]!.y1 - strings[2]!.y1,
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

    expect(caret).toMatchObject({
      beatId: focus.beatId,
      string: 4,
      x: beat.x,
      width: beat.width,
    });
  });
});
