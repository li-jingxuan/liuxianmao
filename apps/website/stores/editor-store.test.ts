import {
  buildLayout,
  EXAMPLE_MVP_4_DOCUMENT,
  LXMScoreCommandEnum,
  validateDocumentSemantics,
} from "@liuxianmao/lxm-editor";
import { describe, expect, it } from "vitest";

import { createEditorStore } from "./editor-store";

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

describe("editor store history", () => {
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
});
