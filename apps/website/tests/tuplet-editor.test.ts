import { describe, it, expect } from "vitest";
import {
  EXAMPLE_MVP_5_1_DOCUMENT,
  LXMScoreCommandEnum as Command,
  resolveTupletSelection,
  validateDocumentSemantics,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { createEditorStore } from "../stores/editor-store";
const example = EXAMPLE_MVP_5_1_DOCUMENT;
const selection = (index: number): ILXMTabCellSelection => {
  const track = example.score.tracks[0]!,
    measure = track.measures[index]!,
    group = measure.tuplets[0]!;
  return {
    anchor: {
      trackId: track.id,
      measureId: measure.id,
      beatId: group.beatIds.at(-1)!,
      string: 6,
    },
    focus: {
      trackId: track.id,
      measureId: measure.id,
      beatId: group.beatIds[0]!,
      string: 1,
    },
  };
};

describe("连音组编辑与历史", () => {
  it("反向跨弦选区按时间归一，跨小节/空选择不提供工具目标", () => {
    expect(resolveTupletSelection(example, null)).toBe(null);
    const selected = selection(3),
      range = resolveTupletSelection(example, selected)!;
    expect(range.beatIds).toEqual(
      example.score.tracks[0]!.measures[3]!.tuplets[0]!.beatIds,
    );
    expect(range.group?.ratio).toEqual({ actual: 5, normal: 4 });
    const cross = { anchor: selected.anchor, focus: selection(4).focus };
    expect(resolveTupletSelection(example, cross)).toBe(null);
    const one = { anchor: selected.anchor, focus: selected.anchor };
    expect(resolveTupletSelection(example, one)?.beatIds.length).toBe(1);
    expect(resolveTupletSelection(example, one)?.group).toBeUndefined();
  });
  it("改比例、删除、新增各一条历史；no-op 不入历史；撤销重做恢复数据和工具", () => {
    const initial = structuredClone(example),
      store = createEditorStore(initial);
    store.getState().setSelection(selection(3));
    const range = resolveTupletSelection(initial, selection(3))!;
    const cmd = {
      type: Command.SetTuplet as const,
      trackId: range.trackId,
      measureId: range.measureId,
      startBeatId: range.startBeatId,
      endBeatId: range.endBeatId,
      ratio: { actual: 5 as const, normal: 3 as const },
    };
    expect(store.getState().execute(cmd)?.ok).toBe(true);
    const changed = store.getState().document!;
    expect(store.getState().historyDepth.past).toBe(1);
    expect(
      resolveTupletSelection(changed, store.getState().selection)?.group?.ratio
        .normal,
    ).toBe(3);
    store.getState().execute(cmd);
    expect(store.getState().document).toBe(changed);
    expect(store.getState().historyDepth.past).toBe(1);
    store.getState().undo();
    expect(store.getState().document).toBe(initial);
    expect(
      resolveTupletSelection(initial, store.getState().selection)?.group?.ratio
        .normal,
    ).toBe(4);
    store.getState().redo();
    expect(store.getState().document).toBe(changed);
    const removed = store
      .getState()
      .execute({
        type: Command.RemoveTuplet,
        trackId: range.trackId,
        measureId: range.measureId,
        tupletId: range.group!.id,
      });
    expect(removed?.ok).toBe(true);
    expect(store.getState().historyDepth.past).toBe(2);
    expect(
      resolveTupletSelection(
        store.getState().document!,
        store.getState().selection,
      )?.group,
    ).toBeUndefined();
    store.getState().execute(cmd);
    expect(store.getState().historyDepth.past).toBe(3);
    expect(validateDocumentSemantics(store.getState().document!).ok).toBe(true);
  });
  it("失败不改文档、选区或历史；复制后 undo/redo 恢复完整组", () => {
    const initial = structuredClone(example),
      store = createEditorStore(initial);
    const selected = selection(3);
    store.getState().setSelection(selected);
    const trackId = selected.anchor.trackId,
      measureId = selected.anchor.measureId;
    expect(
      store
        .getState()
        .execute({
          type: Command.SetBeatRhythm,
          trackId,
          measureId,
          beatId: selected.anchor.beatId,
          rhythm: { base: "quarter", dots: 0 },
        }),
    ).toMatchObject({ ok: false, code: "BEAT_IN_TUPLET" });
    expect(store.getState().document).toBe(initial);
    expect(store.getState().selection).toBe(selected);
    expect(store.getState().historyDepth.past).toBe(0);
    store.getState().execute({ type: Command.CopyMeasure, trackId, measureId });
    const copied = store.getState().document!;
    expect(copied.score.tracks[0]!.measures).toHaveLength(9);
    expect(validateDocumentSemantics(copied).ok).toBe(true);
    store.getState().undo();
    expect(store.getState().document).toBe(initial);
    store.getState().redo();
    expect(store.getState().document).toBe(copied);
  });
});
