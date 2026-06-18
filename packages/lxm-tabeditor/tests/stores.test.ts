import { beforeEach, describe, expect, it } from "vitest";
import {
  clearScoreHistory,
  pauseScoreHistory,
  redoScore,
  resumeScoreHistory,
  undoScore,
  useScoreStore,
} from "../src/store/score-store";
import { useEditorStore } from "../src/store/editor-store";
import { useViewportStore } from "../src/store/viewport-store";
import { createExampleDocument } from "../src/testing/example-document";

const updateFretCommand = (fret: number) => ({
  type: "note.updateFret" as const,
  payload: {
    trackId: "track-guitar-001",
    measureId: "measure-001",
    beatId: "beat-001-05",
    noteId: "note-001-05-01",
    fret,
  },
});

describe("Zustand 与 zundo 历史", () => {
  beforeEach(() => {
    useScoreStore.getState().loadDocument(createExampleDocument());
    clearScoreHistory();
    useEditorStore.getState().resetEditorState();
    useViewportStore.setState({ zoom: 1, scrollX: 0, scrollY: 0 });
  });

  it("连续命令能够完整 undo 和 redo", () => {
    const original = structuredClone(useScoreStore.getState().score);
    useScoreStore.getState().executeCommand(updateFretCommand(7));
    useScoreStore.getState().executeCommand(updateFretCommand(9));
    undoScore();
    undoScore();
    expect(useScoreStore.getState().score).toEqual(original);
    redoScore();
    redoScore();
    expect(useScoreStore.getState().score).not.toEqual(original);
  });

  it("transaction 只生成一个历史快照", () => {
    useScoreStore
      .getState()
      .executeTransaction([updateFretCommand(7), updateFretCommand(9)]);
    expect(useScoreStore.temporal.getState().pastStates).toHaveLength(1);
  });

  it("暂停期间不记录历史，恢复后继续记录", () => {
    pauseScoreHistory();
    useScoreStore.getState().executeCommand(updateFretCommand(7));
    resumeScoreHistory();
    expect(useScoreStore.temporal.getState().pastStates).toHaveLength(0);
    useScoreStore.getState().executeCommand(updateFretCommand(9));
    expect(useScoreStore.temporal.getState().pastStates).toHaveLength(1);
  });

  it("编辑器和视口临时状态不进入 score 历史", () => {
    useEditorStore.getState().setSelectedNoteIds(["note-001-05-01"]);
    useViewportStore.getState().setZoom(1.5);
    expect(useScoreStore.temporal.getState().pastStates).toHaveLength(0);
    useScoreStore.getState().executeCommand(updateFretCommand(7));
    undoScore();
    expect(useEditorStore.getState().selectedNoteIds).toEqual([
      "note-001-05-01",
    ]);
    expect(useViewportStore.getState().zoom).toBe(1.5);
  });

  it("加载新文档会清空历史", () => {
    useScoreStore.getState().executeCommand(updateFretCommand(7));
    expect(useScoreStore.temporal.getState().pastStates).toHaveLength(1);
    useScoreStore.getState().loadDocument(createExampleDocument());
    expect(useScoreStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
