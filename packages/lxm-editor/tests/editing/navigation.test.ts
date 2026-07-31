import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_4 from "../../example/example-mvp4.json";
import { navigateTabCellSelection } from "../../src/editing/navigation";

const cell = (measure: number, beat: number, string: number) => ({
  trackId: "mvp2-track-guitar",
  measureId: `mvp2-measure-${measure}`,
  beatId: `mvp2-beat-${measure}-${beat}`,
  string,
});

describe("navigateTabCellSelection", () => {
  it("左右移动遵循 Beat 文档顺序并可跨小节", () => {
    const selection = {
      anchor: cell(1, 9, 3),
      focus: cell(1, 9, 3),
    };
    const next = navigateTabCellSelection(EXAMPLE_MVP_4, selection, "right");

    expect(next).toMatchObject({
      ok: true,
      changed: true,
      selection: {
        anchor: { beatId: "mvp2-beat-2-1", string: 3 },
        focus: { beatId: "mvp2-beat-2-1", string: 3 },
      },
    });
  });

  it("上下移动遵守 1–6 弦边界", () => {
    const top = { anchor: cell(1, 1, 1), focus: cell(1, 1, 1) };
    const bottom = { anchor: cell(1, 1, 6), focus: cell(1, 1, 6) };

    expect(navigateTabCellSelection(EXAMPLE_MVP_4, top, "up")).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(
      navigateTabCellSelection(EXAMPLE_MVP_4, bottom, "down"),
    ).toMatchObject({ ok: true, changed: false });
    expect(navigateTabCellSelection(EXAMPLE_MVP_4, top, "down")).toMatchObject({
      ok: true,
      changed: true,
      selection: { focus: { string: 2 } },
    });
  });

  it("Shift 扩展只移动 focus 并保持 anchor", () => {
    const anchor = cell(1, 2, 3);
    const next = navigateTabCellSelection(
      EXAMPLE_MVP_4,
      { anchor, focus: anchor },
      "right",
      true,
    );

    expect(next).toMatchObject({
      ok: true,
      changed: true,
      selection: {
        anchor,
        focus: { beatId: "mvp2-beat-1-3", string: 3 },
      },
    });
  });

  it("普通左右键把范围折叠到对应 Beat 边界", () => {
    const selection = {
      anchor: cell(1, 5, 2),
      focus: cell(2, 2, 5),
    };

    expect(
      navigateTabCellSelection(EXAMPLE_MVP_4, selection, "left"),
    ).toMatchObject({
      ok: true,
      selection: {
        anchor: { beatId: "mvp2-beat-1-5", string: 5 },
        focus: { beatId: "mvp2-beat-1-5", string: 5 },
      },
    });
    expect(
      navigateTabCellSelection(EXAMPLE_MVP_4, selection, "right"),
    ).toMatchObject({
      ok: true,
      selection: {
        anchor: { beatId: "mvp2-beat-2-2", string: 5 },
        focus: { beatId: "mvp2-beat-2-2", string: 5 },
      },
    });
  });

  it("普通上下键从范围 focus 再移动一根弦并折叠", () => {
    const next = navigateTabCellSelection(
      EXAMPLE_MVP_4,
      { anchor: cell(1, 2, 2), focus: cell(1, 4, 4) },
      "up",
    );

    expect(next).toMatchObject({
      ok: true,
      selection: {
        anchor: { beatId: "mvp2-beat-1-4", string: 3 },
        focus: { beatId: "mvp2-beat-1-4", string: 3 },
      },
    });
  });
});
