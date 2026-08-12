import {
  buildLayout,
  EXAMPLE_MVP_4_DOCUMENT,
  LXMScoreCommandEnum,
  validateDocumentSemantics,
} from "@liuxianmao/lxm-editor";
import { describe, expect, it } from "vitest";

import { createEditorStore } from "../stores/editor-store";

const EXAMPLE_MVP_4 = EXAMPLE_MVP_4_DOCUMENT;

const target = {
  trackId: "mvp2-track-guitar",
  measureId: "mvp2-measure-1",
  beatId: "mvp2-beat-1-1",
};

const selection = {
  anchor: { ...target, string: 6 },
  focus: { ...target, string: 6 },
};

/** 构造一个可安全缩容的首小节，用于观察尾部休止 ID 失效后的选区回退。 */
const createTimeSignatureDocument = (measureIndex = 0) => {
  const document = structuredClone(EXAMPLE_MVP_4);
  const measure = document.score.tracks[0]!.measures[measureIndex]!;
  measure.chordSymbols = [];
  measure.beats = [0, 960, 1920, 2880].map((tick, index) => ({
    id: `store-old-rest-${measureIndex + 1}-${index + 1}`,
    tick,
    rhythm: { base: "quarter" as const, dots: 0 },
    kind: "rest" as const,
    notes: [],
  }));
  return document;
};

describe("editor store history", () => {
  it("小节边界修改产生一条历史并可撤销重做", () => {
    const initial = structuredClone(EXAMPLE_MVP_4);
    const store = createEditorStore(initial);

    store.getState().execute({
      type: LXMScoreCommandEnum.SetBarlineBoundary,
      trackId: target.trackId,
      boundary: { kind: "afterMeasure", measureId: target.measureId },
      barline: "double",
    });
    expect(
      store.getState().document?.score.tracks[0]?.measures[0]?.barline,
    ).toBe("double");
    expect(store.getState().historyDepth).toEqual({ past: 1, future: 0 });

    store.getState().undo();
    expect(store.getState().document).toBe(initial);
    store.getState().redo();
    expect(
      store.getState().document?.score.tracks[0]?.measures[0]?.barline,
    ).toBe("double");
  });

  it("成功命令入历史，失败与 no-op 不入历史", () => {
    const store = createEditorStore(structuredClone(EXAMPLE_MVP_4));
    store.getState().setSelection(selection);

    store.getState().execute({
      type: LXMScoreCommandEnum.SetNote,
      ...target,
      string: 6,
      fret: 0,
    });
    expect(store.getState().historyDepth).toEqual({ past: 0, future: 0 });

    store.getState().execute({
      type: LXMScoreCommandEnum.SetNote,
      ...target,
      string: 6,
      fret: 3,
    });
    expect(store.getState()).toMatchObject({
      canUndo: true,
      canRedo: false,
      historyDepth: { past: 1, future: 0 },
    });

    store.getState().execute({
      type: LXMScoreCommandEnum.SetNote,
      ...target,
      trackId: "missing",
      string: 6,
      fret: 4,
    });
    expect(store.getState().historyDepth).toEqual({ past: 1, future: 0 });
    expect(store.getState().errorMessage).toBeTruthy();
  });

  it("矩形设置和删除各产生一条历史", () => {
    const store = createEditorStore(structuredClone(EXAMPLE_MVP_4));
    const range = {
      trackId: target.trackId,
      anchor: { measureId: target.measureId, beatId: target.beatId, string: 1 },
      focus: {
        measureId: "mvp2-measure-2",
        beatId: "mvp2-beat-2-2",
        string: 3,
      },
    };

    store.getState().execute({
      type: LXMScoreCommandEnum.SetNotesInRect,
      range,
      fret: 12,
    });
    store.getState().execute({
      type: LXMScoreCommandEnum.RemoveNotesInRect,
      range,
    });
    expect(store.getState().historyDepth.past).toBe(2);
  });

  it("undo/redo 恢复文档，分支编辑清空 redo", () => {
    const initial = structuredClone(EXAMPLE_MVP_4);
    const store = createEditorStore(initial);
    store.getState().execute({
      type: LXMScoreCommandEnum.SetNote,
      ...target,
      string: 6,
      fret: 3,
    });
    const edited = store.getState().document;

    store.getState().undo();
    expect(store.getState().document).toBe(initial);
    expect(store.getState()).toMatchObject({ canUndo: false, canRedo: true });

    store.getState().redo();
    expect(store.getState().document).toBe(edited);
    expect(store.getState()).toMatchObject({ canUndo: true, canRedo: false });

    store.getState().undo();
    store.getState().execute({
      type: LXMScoreCommandEnum.SetNote,
      ...target,
      string: 6,
      fret: 5,
    });
    expect(store.getState()).toMatchObject({ canUndo: true, canRedo: false });
    expect(store.getState().historyDepth.future).toBe(0);
  });

  it("selection/error 变化不进入历史，失效 selection 安全回退", () => {
    const store = createEditorStore(structuredClone(EXAMPLE_MVP_4));
    const lastMeasureSelection = {
      anchor: {
        trackId: target.trackId,
        measureId: "mvp2-measure-8",
        beatId: "mvp2-beat-8-1",
        string: 2,
      },
      focus: {
        trackId: target.trackId,
        measureId: "mvp2-measure-8",
        beatId: "mvp2-beat-8-1",
        string: 2,
      },
    };
    store.getState().setSelection(lastMeasureSelection);
    store.getState().setErrorMessage("临时错误");
    expect(store.getState().historyDepth.past).toBe(0);

    store.getState().execute({
      type: LXMScoreCommandEnum.RemoveMeasure,
      trackId: target.trackId,
      measureId: "mvp2-measure-8",
    });
    expect(store.getState().selection?.focus).toMatchObject({
      measureId: "mvp2-measure-7",
      string: 2,
    });
    expect(store.getState().historyDepth.past).toBe(1);
  });

  it("历史最多保留 100 条 document 快照", () => {
    const store = createEditorStore(structuredClone(EXAMPLE_MVP_4));
    for (let index = 0; index < 101; index += 1) {
      store.getState().execute({
        type: LXMScoreCommandEnum.SetNote,
        ...target,
        string: 6,
        fret: index % 2 === 0 ? 1 : 2,
      });
    }
    expect(store.getState().historyDepth.past).toBe(100);
  });

  it("undo/redo 后的 document 仍可通过语义校验和 layout", () => {
    const store = createEditorStore(structuredClone(EXAMPLE_MVP_4));
    store.getState().execute({
      type: LXMScoreCommandEnum.CopyMeasure,
      trackId: target.trackId,
      measureId: target.measureId,
    });
    store.getState().undo();
    store.getState().redo();
    const document = store.getState().document;

    expect(document).not.toBeNull();
    if (!document) return;
    expect(validateDocumentSemantics(document)).toEqual({ ok: true });
    expect(
      buildLayout(document, { systemWidth: 733 }).systems.length,
    ).toBeGreaterThan(0);
  });

  it("拍号修改只产生一条历史并可撤销重做", () => {
    const initial = createTimeSignatureDocument();
    const store = createEditorStore(initial);

    store.getState().execute({
      type: LXMScoreCommandEnum.SetTimeSignature,
      trackId: target.trackId,
      measureId: target.measureId,
      timeSignature: { numerator: 3, denominator: 4 },
      scope: "measure",
    });
    expect(store.getState().historyDepth).toEqual({ past: 1, future: 0 });
    expect(
      store.getState().document?.score.tracks[0]?.measures[0]?.timeSignature,
    ).toEqual({ numerator: 3, denominator: 4 });

    store.getState().undo();
    expect(store.getState().document).toBe(initial);
    store.getState().redo();
    expect(
      store.getState().document?.score.tracks[0]?.measures[0]?.timeSignature,
    ).toEqual({ numerator: 3, denominator: 4 });
  });

  it("Beat 范围休止只产生一条历史，撤销恢复全部音符并保留选区", () => {
    const initial = structuredClone(EXAMPLE_MVP_4);
    const store = createEditorStore(initial);
    const rangeSelection = {
      anchor: {
        trackId: target.trackId,
        measureId: "mvp2-measure-1",
        beatId: "mvp2-beat-1-8",
        string: 2,
      },
      focus: {
        trackId: target.trackId,
        measureId: "mvp2-measure-2",
        beatId: "mvp2-beat-2-1",
        string: 5,
      },
    };
    store.getState().setSelection(rangeSelection);

    store.getState().execute({
      type: LXMScoreCommandEnum.SetBeatKindRange,
      range: {
        trackId: target.trackId,
        anchor: {
          measureId: rangeSelection.anchor.measureId,
          beatId: rangeSelection.anchor.beatId,
        },
        focus: {
          measureId: rangeSelection.focus.measureId,
          beatId: rangeSelection.focus.beatId,
        },
      },
      kind: "rest",
    });

    expect(store.getState().historyDepth).toEqual({ past: 1, future: 0 });
    expect(store.getState().selection).toEqual(rangeSelection);
    expect(
      store
        .getState()
        .document?.score.tracks[0]?.measures.slice(0, 2)
        .flatMap((measure) => measure.beats)
        .filter((beat) =>
          ["mvp2-beat-1-8", "mvp2-beat-1-9", "mvp2-beat-2-1"].includes(beat.id),
        )
        .every((beat) => beat.kind === "rest" && beat.notes.length === 0),
    ).toBe(true);

    store.getState().undo();
    expect(store.getState().document).toBe(initial);
    expect(store.getState().selection).toEqual(rangeSelection);
    expect(
      store.getState().document?.score.tracks[0]?.measures[0]?.beats[7]?.notes
        .length,
    ).toBeGreaterThan(0);

    store.getState().redo();
    expect(store.getState().selection).toEqual(rangeSelection);
  });

  it("尾部休止被重建时回退到目标小节首拍并保留弦号", () => {
    const initial = createTimeSignatureDocument();
    const store = createEditorStore(initial);
    store.getState().setSelection({
      anchor: {
        trackId: target.trackId,
        measureId: target.measureId,
        beatId: "store-old-rest-1-4",
        string: 2,
      },
      focus: {
        trackId: target.trackId,
        measureId: target.measureId,
        beatId: "store-old-rest-1-4",
        string: 2,
      },
    });

    store.getState().execute({
      type: LXMScoreCommandEnum.SetTimeSignature,
      trackId: target.trackId,
      measureId: target.measureId,
      timeSignature: { numerator: 3, denominator: 4 },
      scope: "measure",
    });

    const nextDocument = store.getState().document!;
    const firstBeat = nextDocument.score.tracks[0]!.measures[0]!.beats[0]!;
    expect(store.getState().selection).toEqual({
      anchor: {
        trackId: target.trackId,
        measureId: target.measureId,
        beatId: firstBeat.id,
        string: 2,
      },
      focus: {
        trackId: target.trackId,
        measureId: target.measureId,
        beatId: firstBeat.id,
        string: 2,
      },
    });
    expect(store.getState().selection?.focus.measureId).not.toBe(
      "mvp2-measure-2",
    );
  });

  it("拍号休止 ID 在 undo/redo 间切换时仍留在原目标小节", () => {
    const initial = createTimeSignatureDocument(1);
    const store = createEditorStore(initial);
    const secondMeasureId = "mvp2-measure-2";
    store.getState().setSelection({
      anchor: {
        trackId: target.trackId,
        measureId: secondMeasureId,
        beatId: "store-old-rest-2-4",
        string: 5,
      },
      focus: {
        trackId: target.trackId,
        measureId: secondMeasureId,
        beatId: "store-old-rest-2-4",
        string: 5,
      },
    });
    store.getState().execute({
      type: LXMScoreCommandEnum.SetTimeSignature,
      trackId: target.trackId,
      measureId: secondMeasureId,
      timeSignature: { numerator: 3, denominator: 4 },
      scope: "measure",
    });

    store.getState().undo();
    expect(store.getState().selection?.focus).toMatchObject({
      measureId: secondMeasureId,
      beatId: "store-old-rest-2-1",
      string: 5,
    });
    store.getState().redo();
    expect(store.getState().selection?.focus).toMatchObject({
      measureId: secondMeasureId,
      string: 5,
    });
    expect(
      store.getState().document?.score.tracks[0]?.measures[1]?.timeSignature,
    ).toEqual({ numerator: 3, denominator: 4 });
  });
});
