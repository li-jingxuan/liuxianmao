import { describe, it, expect, vi } from "vitest";
import { createEditorStore } from "../stores/editor-store";
import {
  EXAMPLE_MVP_6_DOCUMENT,
  createCollapsedTabCellSelection,
  LXMScoreCommandEnum as C,
  planBeatPaste,
} from "@liuxianmao/lxm-editor";
/** 真实 store 验证通知/历史和私有剪贴板边界，避免只测试 UI 对命令的包装。 */
const fixture = () => {
  const d = structuredClone(EXAMPLE_MVP_6_DOCUMENT),
    t = d.score.tracks[0]!;
  t.techniques = [];
  t.measures = [
    {
      id: "m",
      timeSignature: { numerator: 4, denominator: 4 },
      barline: "single",
      numberedVoice: { events: [], tuplets: [] },
      tuplets: [],
      lyrics: [],
      chordSymbols: [],
      beats: Array.from({ length: 4 }, (_, i) => ({
        id: `b${i}`,
        tick: i * 960,
        rhythm: { base: "quarter", dots: 0 },
        kind: i === 0 ? "notes" : "rest",
        notes: i === 0 ? [{ id: "n", string: 1, fret: 5 }] : [],
      })),
    },
  ];
  return d;
};
const target = {
  trackId: EXAMPLE_MVP_6_DOCUMENT.score.tracks[0]!.id,
  measureId: "m",
  beatId: "b0",
  string: 1,
};
describe("合并 C 会话契约", () => {
  it("复制无历史/通知，读取快照隔离，失败与非法替换保留，合法替换清空", () => {
    const d = fixture(),
      notify = vi.fn(),
      store = createEditorStore(d, { onChange: notify });
    const range = { ...target, startBeatId: "b0", endBeatId: "b0" };
    expect(store.getState().copyBeats(range)).toBe(true);
    expect(store.getState().historyDepth.past).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    const c = store.getState().getBeatClipboard()!;
    c.content.beats[0]!.notes[0]!.fret = 20;
    expect(
      store.getState().getBeatClipboard()!.content.beats[0]!.notes[0]!.fret,
    ).toBe(5);
    expect(store.getState().copyBeats({ ...range, endBeatId: "missing" })).toBe(
      false,
    );
    expect(store.getState().getBeatClipboard()).not.toBeNull();
    expect(store.getState().replaceDocument({}).ok).toBe(false);
    expect(store.getState().getBeatClipboard()).not.toBeNull();
    expect(store.getState().replaceDocument(d).ok).toBe(true);
    expect(store.getState().getBeatClipboard()).toBeNull();
  });
  it("结构命令一次历史/通知，合并回首拍，撤销/重做版本递增且保留快照", () => {
    const d = fixture(),
      notify = vi.fn(),
      store = createEditorStore(d, { onChange: notify });
    store.getState().setSelection(createCollapsedTabCellSelection(target));
    store
      .getState()
      .copyBeats({ ...target, startBeatId: "b0", endBeatId: "b0" });
    const r = store.getState().execute({ type: C.SplitBeat, ...target });
    expect(r?.ok).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.getState().historyDepth.past).toBe(1);
    const next =
      store.getState().document!.score.tracks[0]!.measures[0]!.beats[1]!.id;
    store
      .getState()
      .setSelection(
        createCollapsedTabCellSelection({ ...target, beatId: next, string: 4 }),
      );
    expect(
      store.getState().execute({
        type: C.MergeBeats,
        ...target,
        startBeatId: "b0",
        endBeatId: next,
      })?.ok,
    ).toBe(true);
    expect(store.getState().selection?.focus).toMatchObject({
      beatId: "b0",
      string: 4,
    });
    const version = store.getState().stateVersion;
    store.getState().undo();
    store.getState().redo();
    expect(store.getState().stateVersion).toBe(version + 2);
    expect(store.getState().getBeatClipboard()).not.toBeNull();
    expect(notify).toHaveBeenCalledTimes(4);
  });
  it("粘贴失败保留文档和选区，成功聚焦副本，简谱批次只通知一次", () => {
    const d = fixture(),
      notify = vi.fn(),
      store = createEditorStore(d, { onChange: notify });
    store
      .getState()
      .setSelection(
        createCollapsedTabCellSelection({ ...target, beatId: "b1" }),
      );
    store
      .getState()
      .copyBeats({ ...target, startBeatId: "b0", endBeatId: "b0" });
    const c = store.getState().getBeatClipboard()!,
      p = planBeatPaste(d, { ...target, beatId: "b1", mode: "insert" }, c);
    if (!p.ok) throw Error(p.message);
    const cmd = {
      type: C.PasteBeats as const,
      ...target,
      beatId: "b1",
      mode: "insert" as const,
      clipboard: c,
      allowOverwrite: false,
      expectedConfirmationKey: p.confirmationKey,
    };
    expect(
      store.getState().execute({ ...cmd, expectedConfirmationKey: "stale" })
        ?.ok,
    ).toBe(false);
    expect(store.getState().document).toBe(d);
    expect(store.getState().selection?.focus.beatId).toBe("b1");
    expect(store.getState().execute(cmd)?.ok).toBe(true);
    expect(store.getState().selection?.focus.beatId).toBe(p.nextFocus.beatId);
    expect(notify).toHaveBeenCalledTimes(1);
    const next = store.getState().selection!.focus;
    expect(
      store.getState().execute({
        type: "numbered.range.replace",
        trackId: next.trackId,
        measureId: next.measureId,
        startTick: store
          .getState()
          .document!.score.tracks[0]!.measures[0]!.beats.find(
            (b) => b.id === next.beatId,
          )!.tick,
        endTick:
          store
            .getState()
            .document!.score.tracks[0]!.measures[0]!.beats.find(
              (b) => b.id === next.beatId,
            )!.tick + 1920,
        rhythms: [
          { base: "quarter", dots: 0 },
          { base: "quarter", dots: 0 },
        ],
        items: [
          { kind: "set", tokens: ["1"] },
          { kind: "set", tokens: ["3"] },
        ],
        allowOverwrite: false,
      })?.ok,
    ).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(store.getState().historyDepth.past).toBe(2);
  });
});
