import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_4 from "../../example/example-mvp4.json";
import {
  MAX_TAB_CELL_RANGE_CELLS,
  buildOrderedBeatIndex,
  resolveTabCellSelection,
  type ILXMTabCellSelection,
} from "../../src/editing/tab-cell-selection";

const reference = (measure: number, beat: number, string: number) => ({
  trackId: "mvp2-track-guitar",
  measureId: `mvp2-measure-${measure}`,
  beatId: `mvp2-beat-${measure}-${beat}`,
  string,
});

describe("resolveTabCellSelection", () => {
  it("解析单格、横向、纵向和二维矩形", () => {
    const cases: [ILXMTabCellSelection, number, number, number][] = [
      [{ anchor: reference(1, 1, 3), focus: reference(1, 1, 3) }, 1, 3, 3],
      [{ anchor: reference(1, 1, 2), focus: reference(1, 4, 2) }, 4, 2, 2],
      [{ anchor: reference(1, 2, 1), focus: reference(1, 2, 4) }, 4, 1, 4],
      [{ anchor: reference(1, 2, 2), focus: reference(1, 5, 4) }, 12, 2, 4],
    ];

    for (const [selection, cellCount, startString, endString] of cases) {
      const result = resolveTabCellSelection(EXAMPLE_MVP_4, selection);
      expect(result).toMatchObject({
        ok: true,
        range: { cellCount, startString, endString },
      });
    }
  });

  it("正向、反向和对角拖动得到相同规范范围", () => {
    const forward = resolveTabCellSelection(EXAMPLE_MVP_4, {
      anchor: reference(1, 8, 2),
      focus: reference(2, 2, 5),
    });
    const reverse = resolveTabCellSelection(EXAMPLE_MVP_4, {
      anchor: reference(2, 2, 5),
      focus: reference(1, 8, 2),
    });

    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({
      ok: true,
      range: {
        startString: 2,
        endString: 5,
        beats: [
          { beatId: "mvp2-beat-1-8" },
          { beatId: "mvp2-beat-1-9" },
          { beatId: "mvp2-beat-2-1" },
          { beatId: "mvp2-beat-2-2" },
        ],
      },
    });
  });

  it("Beat 索引遵循 measure 顺序和小节内 tick 顺序", () => {
    const track = structuredClone(EXAMPLE_MVP_4.score.tracks[0]!);
    track.measures[0]!.beats.reverse();

    const ordered = buildOrderedBeatIndex(track);
    expect(ordered.slice(0, 3).map((beat) => beat.beatId)).toEqual([
      "mvp2-beat-1-1",
      "mvp2-beat-1-2",
      "mvp2-beat-1-3",
    ]);
    expect(
      ordered.find((beat) => beat.beatId === "mvp2-beat-2-1"),
    ).toMatchObject({ measureIndex: 1, beatIndex: 0 });
  });

  it("拒绝失效端点、跨轨道和非法弦号", () => {
    expect(
      resolveTabCellSelection(EXAMPLE_MVP_4, {
        anchor: reference(1, 1, 1),
        focus: { ...reference(1, 2, 1), beatId: "missing" },
      }),
    ).toMatchObject({ ok: false, code: "INVALID_TAB_CELL_RANGE" });
    expect(
      resolveTabCellSelection(EXAMPLE_MVP_4, {
        anchor: reference(1, 1, 1),
        focus: { ...reference(1, 2, 1), trackId: "another-track" },
      }),
    ).toMatchObject({ ok: false, code: "INVALID_TAB_CELL_RANGE" });
    expect(
      resolveTabCellSelection(EXAMPLE_MVP_4, {
        anchor: reference(1, 1, 0),
        focus: reference(1, 2, 1),
      }),
    ).toMatchObject({ ok: false, code: "INVALID_TAB_CELL_RANGE" });
  });

  it("对合法端点形成的超限矩形返回专用错误且不修改输入", () => {
    const document = structuredClone(EXAMPLE_MVP_4);
    const measure = document.score.tracks[0]!.measures[0]!;
    measure.beats = Array.from({ length: 86 }, (_, index) => ({
      ...measure.beats[0]!,
      id: `large-range-beat-${index}`,
      tick: index,
    }));
    const selection = {
      anchor: {
        trackId: "mvp2-track-guitar",
        measureId: measure.id,
        beatId: "large-range-beat-0",
        string: 1,
      },
      focus: {
        trackId: "mvp2-track-guitar",
        measureId: measure.id,
        beatId: "large-range-beat-85",
        string: 6,
      },
    } satisfies ILXMTabCellSelection;
    const snapshot = structuredClone(document);

    expect(resolveTabCellSelection(document, selection)).toEqual({
      ok: false,
      code: "TAB_CELL_RANGE_TOO_LARGE",
      message: `TAB 单元格选区最多包含 ${MAX_TAB_CELL_RANGE_CELLS} 个单元格`,
    });
    expect(document).toEqual(snapshot);
  });
});
