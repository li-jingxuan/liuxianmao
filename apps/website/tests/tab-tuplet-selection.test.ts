import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_5_1_DOCUMENT,
  buildLayout,
  resolveTupletSelection,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { resolveScorePointerAction } from "../components/EditorShell/editor-object-selection";
import { createEditorStore } from "../stores/editor-store";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_5_1_DOCUMENT);
  const layout = buildLayout(document, { systemWidth: 720 });
  const measure = layout.systems[1]!.measures[0]!;
  const group = measure.tuplets[0]!;
  const point = {
    x: group.label.x,
    y: group.label.y - group.label.fontSize / 2,
  };
  return { document, layout, measure, group, point };
};

describe("TAB 连音一键选择", () => {
  it.each([false, true])("Shift=%s 点击数字或括号都选全组，沿用当前 focus 弦号且不启动拖动", (extend) => {
    const { document, layout, measure, group, point } = fixture();
    const selection: ILXMTabCellSelection = {
      anchor: {
        trackId: layout.trackId,
        measureId: layout.systems[0]!.measures[0]!.id,
        beatId: layout.systems[0]!.measures[0]!.beats[0]!.id,
        string: 1,
      },
      focus: {
        trackId: layout.trackId,
        measureId: measure.id,
        beatId: measure.beats.at(-1)!.id,
        string: 5,
      },
    };
    for (const hitPoint of [point, ...group.bracket!.lines.map((line) => ({
      x: (line.x1 + line.x2) / 2,
      y: (line.y1 + line.y2) / 2,
    }))]) {
      const action = resolveScorePointerAction(document, layout, hitPoint, selection, extend);
      expect(action).toEqual({
        type: "selection",
        startDrag: false,
        selection: {
          anchor: { ...selection.focus, beatId: group.beatIds[0]! },
          focus: { ...selection.focus, beatId: group.beatIds.at(-1)! },
        },
      });
      if (action?.type !== "selection") throw new Error("missing selection");
      expect(resolveTupletSelection(document, action.selection)?.group?.id).toBe(group.id);
    }
  });

  it("无选区默认第一弦，现有连音工具识别整组且不写文档或历史", () => {
    const { document, layout, group, point } = fixture();
    const store = createEditorStore(document);
    const action = resolveScorePointerAction(document, layout, point, null, false);
    if (action?.type !== "selection") throw new Error("missing selection");
    expect(action.selection?.anchor.string).toBe(1);
    expect(action.selection?.focus.string).toBe(1);
    store.getState().setSelection(action.selection);
    expect(resolveTupletSelection(document, store.getState().selection)?.beatIds).toEqual(group.beatIds);
    expect(store.getState().document).toBe(document);
    expect(store.getState().historyDepth).toEqual({ past: 0, future: 0 });
  });

  it("连音优先于 TAB 弦格，已有技巧对象仍保留优先级", () => {
    const { document, layout, measure, group } = fixture();
    // 将最终括号的一段放到弦格上，验证实际分派顺序而非依赖自然净空。
    const point = { x: measure.beats[0]!.x, y: measure.strings[0]!.y1 };
    group.bracket!.lines[0] = { x1: point.x - 10, x2: point.x + 10, y1: point.y, y2: point.y };
    expect(resolveScorePointerAction(document, layout, point, null, false))
      .toMatchObject({ type: "selection", startDrag: false, selection: {
        anchor: { beatId: group.beatIds[0] },
        focus: { beatId: group.beatIds.at(-1) },
      } });
    layout.hitIndex.techniqueBounds.push({
      trackId: layout.trackId,
      techniqueId: "overlapping-technique",
      systemIndex: 1,
      x: point.x - 2, y: point.y - 2, width: 4, height: 4,
    });
    expect(resolveScorePointerAction(document, layout, point, null, false))
      .toMatchObject({ type: "selection", techniqueId: "overlapping-technique" });
  });

  it("普通弦格继续生成可拖动单格选区，连音周围空白仍清空选区", () => {
    const { document, layout, measure, group } = fixture();
    const action = resolveScorePointerAction(document, layout, {
      x: measure.beats[0]!.x, y: measure.strings[0]!.y1,
    }, null, false);
    expect(action?.type === "selection" && action.startDrag).toBeUndefined();
    expect(action?.type === "selection" && action.selection?.anchor)
      .toEqual(action?.type === "selection" && action.selection?.focus);
    const line = group.bracket!.lines[0]!;
    expect(resolveScorePointerAction(document, layout, {
      x: (line.x1 + line.x2) / 2, y: line.y1 + 15,
    }, null, false)).toEqual({ type: "selection", selection: null });
  });
});
