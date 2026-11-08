import {
  EXAMPLE_MVP_4_DOCUMENT,
  LXMScoreCommandEnum as C,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import { describe, expect, it, vi } from "vitest";
import {
  createEditorStore,
  selectEditorHistory,
  selectHistoryEntries,
  type EditorStoreState,
} from "../stores/editor-store";
import { createHistoryEntry } from "../stores/editor-history";

const target = {
  trackId: "mvp2-track-guitar",
  measureId: "mvp2-measure-1",
  beatId: "mvp2-beat-1-1",
};
const fixture = () => structuredClone(EXAMPLE_MVP_4_DOCUMENT);
const setNote = (fret: number): ILXMScoreCommand => ({
  type: C.SetNote, ...target, string: 6, fret,
});
const assertHistory = (state: EditorStoreState) => {
  expect(state.history.past.length).toBe(state.pastEntries.length);
  expect(state.history.future.length).toBe(state.futureEntries.length);
  expect(state.historyEntries).toEqual([...state.pastEntries, ...state.futureEntries]);
  expect(state.historyEntries.length).toBeLessThanOrEqual(100);
  expect(state.historyView.appliedCount).toBe(state.pastEntries.length);
  expect(state.historyView.currentEntryId).toBe(state.pastEntries.at(-1)?.id ?? null);
  expect(state.historyView.entries).toBe(state.historyEntries);
  expect(state.canUndo).toBe(state.pastEntries.length > 0);
  expect(state.canRedo).toBe(state.futureEntries.length > 0);
};

/** 单个跨界技巧及简谱连线，为两种 clipboard 路径提供真实 omissions。 */
const omissionFixture = () => {
  const document = fixture();
  const track = document.score.tracks[0]!;
  track.techniques = [{
    id: "cross-beat-technique", type: "slideUp",
    fromNoteId: "mvp2-note-1-1-6", toNoteId: "mvp2-note-1-5-6",
  }];
  track.measures[0]!.numberedVoice = {
    tuplets: [],
    events: [0, 960].map((tick, index) => ({
      id: `numbered-${index}`, tick,
      kind: "notes", rhythm: { base: "quarter", dots: 0 },
      items: [{ id: `item-${index}`, token: "1" }],
    })),
  };
  track.numberedMarks = [{
    id: "cross-numbered-slur", type: "slur",
    fromEventId: "numbered-0", toEventId: "numbered-1",
  }];
  return document;
};

describe("history metadata transactions", () => {
  it("每次订阅发布同步快照与 metadata；全撤销顺序和 redo 复用条目身份", () => {
    const store = createEditorStore(fixture());
    const check = vi.fn(assertHistory);
    store.subscribe(check);
    for (const fret of [1, 2, 3]) store.getState().execute(setNote(fret));
    const entries = store.getState().historyEntries;
    for (let index = 0; index < 3; index++) store.getState().undo();
    expect(store.getState().futureEntries).toEqual(entries);
    expect(store.getState().historyView.currentEntryId).toBeNull();
    expect(store.getState().baselineAdvanced).toBe(false);
    for (let index = 0; index < 3; index++) store.getState().redo();
    entries.forEach((entry, index) => expect(store.getState().pastEntries[index]).toBe(entry));
    expect(check).toHaveBeenCalledTimes(9);
  });

  it("101 次操作裁切起点，全部撤销/重做仍保留裁切标记和 100 个稳定 ID", () => {
    const store = createEditorStore(fixture());
    store.subscribe(assertHistory);
    store.getState().execute(setNote(1));
    const firstId = store.getState().pastEntries[0]!.id;
    for (let index = 1; index < 101; index++)
      store.getState().execute(setNote(index % 2 ? 2 : 1));
    const retained = store.getState().historyEntries;
    expect(retained).toHaveLength(100);
    expect(retained.some((entry) => entry.id === firstId)).toBe(false);
    expect(new Set(retained.map((entry) => entry.id)).size).toBe(100);
    for (let index = 0; index < 100; index++) store.getState().undo();
    expect(store.getState().baselineAdvanced).toBe(true);
    expect(store.getState().historyView.currentEntryId).toBeNull();
    expect(store.getState().futureEntries).toEqual(retained);
    expect(store.getState().document?.score.tracks[0]!.measures[0]!.beats[0]!.notes
      .find((note) => note.string === 6)?.fret).toBe(1);
    for (let index = 0; index < 100; index++) store.getState().redo();
    expect(store.getState().baselineAdvanced).toBe(true);
    retained.forEach((entry, index) => expect(store.getState().pastEntries[index]).toBe(entry));
  });

  it("no-op/失败/过期命令不截断 future；分叉和会话重置的 ID 永不复用", () => {
    const store = createEditorStore(fixture());
    store.getState().execute(setNote(3));
    const oldEntry = store.getState().pastEntries[0]!;
    store.getState().undo();
    const view = selectEditorHistory(store.getState());
    expect(store.getState().execute(setNote(0))).toMatchObject({ ok: true, changed: false });
    expect(store.getState().execute({ ...setNote(1), trackId: "missing" } as ILXMScoreCommand))
      .toMatchObject({ ok: false });
    expect(store.getState().execute({ ...setNote(1), expectedRevision: -1 }))
      .toMatchObject({ ok: false });
    expect(selectEditorHistory(store.getState())).toBe(view);
    store.getState().execute(setNote(5));
    expect(store.getState().futureEntries).toEqual([]);
    expect(store.getState().pastEntries[0]!.id).not.toBe(oldEntry.id);
    expect(store.getState().replaceDocument(fixture()).ok).toBe(true);
    store.getState().execute(setNote(3));
    const newEntry = store.getState().pastEntries[0]!;
    expect(newEntry.id).not.toBe(oldEntry.id);
    const otherStore = createEditorStore(fixture());
    otherStore.getState().execute(setNote(3));
    expect(otherStore.getState().pastEntries[0]!.id).not.toBe(newEntry.id);
    assertHistory(store.getState());
  });

  it("只读 selector 在选区、错误、输入节奏、普通复制与反馈关闭时引用稳定", () => {
    const store = createEditorStore(fixture());
    store.getState().execute(setNote(3));
    const entries = selectHistoryEntries(store.getState());
    const view = selectEditorHistory(store.getState());
    store.getState().setSelection({
      anchor: { ...target, string: 6 }, focus: { ...target, string: 6 },
    });
    store.getState().setErrorMessage("temporary");
    store.getState().setNumberedInputRhythm({ base: "eighth", dots: 0 });
    store.getState().copyBeats({
      ...target, startBeatId: target.beatId, endBeatId: target.beatId,
    });
    store.getState().dismissFeedback("obsolete");
    expect(selectHistoryEntries(store.getState())).toBe(entries);
    expect(selectEditorHistory(store.getState())).toBe(view);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[0]!.target.beatIds)).toBe(true);
    expect(view).not.toHaveProperty("past");
    expect(entries[0]).not.toHaveProperty("document");
  });

  it("无 effects 的宿主直接 execute 仍记录；小节删除摘要来自提交前编号", () => {
    const store = createEditorStore(fixture());
    store.getState().execute(setNote(3));
    expect(store.getState().pastEntries[0]).toMatchObject({
      label: "设置音符", effects: [],
      target: { summary: "第 1 轨 · 第 1 小节第 1 拍", beatIds: [target.beatId] },
    });
    store.getState().execute({ type: C.RemoveMeasure, trackId: target.trackId, measureId: "mvp2-measure-2" });
    const entry = store.getState().pastEntries[1]!;
    expect(entry.target.summary).toBe("第 1 轨 · 第 2 小节");
    store.getState().execute({ type: C.RemoveMeasure, trackId: target.trackId, measureId: target.measureId });
    expect(entry.target.summary).toBe("第 1 轨 · 第 2 小节");
  });

  it("摘要构建异常降级，不丢失已经成功的音乐提交或通知", () => {
    const notify = vi.fn();
    const store = createEditorStore(fixture(), { onChange: notify });
    const command = setNote(3);
    Object.defineProperty(command, "range", { get() { throw Error("metadata-only field"); } });
    expect(store.getState().execute(command)).toMatchObject({ ok: true, changed: true });
    expect(store.getState().pastEntries[0]).toMatchObject({
      label: "编辑曲谱", target: { summary: "当前曲谱" },
    });
    expect(notify).toHaveBeenCalledTimes(1);
    assertHistory(store.getState());
  });
});

describe("history/clipboard feedback ownership", () => {
  it("提交 effects、历史、反馈、返回结果与宿主参数相互隔离；undo/redo 不重发反馈", () => {
    const notify = vi.fn((event) => {
      event.effects[0].measureNumber = 900;
      event.command.trackId = "host-mutated";
      throw Error("host failed");
    });
    const report = vi.fn(() => { throw Error("host error failed"); });
    const store = createEditorStore(fixture(), { onChange: notify, onError: report });
    const command: ILXMScoreCommand = { type: C.SplitBeat, ...target };
    const result = store.getState().execute(command);
    expect(result).toMatchObject({ ok: true, changed: true });
    const entry = store.getState().pastEntries[0]!;
    const event = store.getState().feedbackEvent!;
    expect(entry.effects.length).toBeGreaterThan(0);
    expect(event).toMatchObject({ source: "command", entryId: entry.id });
    expect(event.effects).not.toBe(entry.effects);
    expect(event.effects[0]).not.toBe(entry.effects[0]);
    expect(store.getState().effects).not.toBe(entry.effects);
    if (!result?.ok) throw Error("expected success");
    result.effects![0]!.measureNumber = 800;
    store.getState().effects[0]!.measureNumber = 700;
    expect(entry.effects[0]!.measureNumber).toBe(1);
    expect(event.effects[0]!.measureNumber).toBe(1);
    expect(store.getState().document!.score.tracks[0]!.measures[0]!.id).toBe(target.measureId);
    expect(command.trackId).toBe(target.trackId);
    store.getState().undo();
    expect(store.getState().futureEntries[0]).toBe(entry);
    expect(store.getState().feedbackEvent).toBe(event);
    expect(store.getState().effects).toEqual([]);
    store.getState().redo();
    expect(store.getState().pastEntries[0]).toBe(entry);
    expect(store.getState().feedbackEvent).toBe(event);
    expect(notify).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenCalledTimes(3);
    assertHistory(store.getState());
  });

  it("连续事件有独立 ID，旧关闭回调不清新事件；分叉清除已删除条目的入口", () => {
    const store = createEditorStore(fixture());
    store.getState().execute({ type: C.SplitBeat, ...target });
    const first = store.getState().feedbackEvent!;
    store.getState().undo();
    store.getState().execute({ type: C.SplitBeat, ...target });
    const second = store.getState().feedbackEvent!;
    expect(second.eventId).not.toBe(first.eventId);
    expect(second.entryId).not.toBe(first.entryId);
    store.getState().dismissFeedback(first.eventId);
    expect(store.getState().feedbackEvent).toBe(second);
    store.getState().undo();
    store.getState().execute(setNote(3));
    expect(store.getState().feedbackEvent).toBeNull();
    expect(store.getState().historyEntries.some((entry) => entry.id === second.entryId)).toBe(false);
    store.getState().dismissFeedback(second.eventId);
  });

  it("裁切清除旧历史反馈入口，保留详情快照不被修改", () => {
    const store = createEditorStore(fixture());
    store.getState().execute({ type: C.SplitBeat, ...target });
    const event = store.getState().feedbackEvent!;
    for (let index = 0; index < 100; index++)
      store.getState().execute({ type: C.SetCapo, trackId: target.trackId, capo: index % 2 ? 2 : 1 });
    expect(store.getState().baselineAdvanced).toBe(true);
    expect(store.getState().feedbackEvent).toBeNull();
    expect(event.effects[0]!.measureNumber).toBe(1);
  });

  it.each(["tab", "numbered"] as const)("%s 复制 omissions 是独立反馈，不入历史或通知", (source) => {
    const onChange = vi.fn();
    const store = createEditorStore(omissionFixture(), { onChange });
    const before = store.getState().document;
    const copy = () => source === "tab"
      ? store.getState().copyBeats({ ...target, startBeatId: target.beatId, endBeatId: target.beatId })
      : store.getState().copyNumberedRange({ ...target, startTick: 0, endTick: 960 });
    expect(copy()).toBe(true);
    const first = store.getState().feedbackEvent!;
    expect(first).toMatchObject({ source: "clipboard" });
    expect(first.entryId).toBeUndefined();
    expect(first.effects.length).toBeGreaterThan(0);
    store.getState().effects[0]!.measureNumber = 800;
    expect(first.effects[0]!.measureNumber).toBe(1);
    expect(copy()).toBe(true);
    const second = store.getState().feedbackEvent!;
    expect(second.eventId).not.toBe(first.eventId);
    store.getState().dismissFeedback(first.eventId);
    expect(store.getState().feedbackEvent).toBe(second);
    expect(store.getState().document).toBe(before);
    expect(store.getState().historyEntries).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    const failed = source === "tab"
      ? store.getState().copyBeats({ ...target, startBeatId: target.beatId, endBeatId: "missing" })
      : store.getState().copyNumberedRange({ ...target, startTick: 1, endTick: 960 });
    expect(failed).toBe(false);
    expect(store.getState().feedbackEvent).toBe(second);
    store.getState().dismissFeedback(second.eventId);
    expect(store.getState().feedbackEvent).toBeNull();
    expect(second.effects.length).toBeGreaterThan(0);
  });

  it("复制无遗漏/no-op/错误不生成残留 effects 反馈；成功换文档清空且失败导入保留", () => {
    const store = createEditorStore(fixture());
    store.getState().execute({ type: C.SplitBeat, ...target });
    const event = store.getState().feedbackEvent!;
    const view = store.getState().historyView;
    expect(store.getState().copyBeats({ ...target, startBeatId: "mvp2-beat-1-2", endBeatId: "mvp2-beat-1-2" })).toBe(true);
    expect(store.getState().effects).toEqual([]);
    expect(store.getState().feedbackEvent).toBe(event);
    expect(store.getState().execute(setNote(0))).toMatchObject({ changed: false });
    expect(store.getState().feedbackEvent).toBe(event);
    store.getState().execute({ ...setNote(2), trackId: "missing" } as ILXMScoreCommand);
    expect(store.getState().feedbackEvent).toBe(event);
    expect(store.getState().replaceDocument({}).ok).toBe(false);
    expect(store.getState().feedbackEvent).toBe(event);
    expect(store.getState().historyView).toBe(view);
    const sessionVersion = store.getState().sessionVersion;
    expect(store.getState().replaceDocument(fixture()).ok).toBe(true);
    expect(store.getState().sessionVersion).toBe(sessionVersion + 1);
    expect(store.getState().feedbackEvent).toBeNull();
    expect(store.getState().effects).toEqual([]);
    expect(store.getState().historyEntries).toEqual([]);
    expect(store.getState().baselineAdvanced).toBe(false);
    assertHistory(store.getState());
  });
});

describe("history metadata summaries", () => {
  it("未知命令与新增对象无旧位置时使用兜底，不杜撰小节或复制输入文本", () => {
    const document = fixture();
    const unknown = createHistoryEntry("unknown", document, {
      type: "future.command", ...target, text: "private text",
    } as unknown as ILXMScoreCommand, []);
    expect(unknown).toEqual({ id: "unknown", label: "编辑曲谱", target: { summary: "当前曲谱" }, effects: [] });
    const insert = createHistoryEntry("insert", document, { type: C.InsertMeasure, trackId: target.trackId }, []);
    expect(insert.target).toEqual({ summary: "第 1 轨", trackId: target.trackId });
    const lyric = createHistoryEntry("lyric", document, {
      type: C.SetLyric, ...target, verse: 1, tick: 0, endTick: 960, text: "private text",
    }, []);
    expect(JSON.stringify(lyric)).not.toContain("private text");
    expect(lyric).not.toHaveProperty("command");
  });

  it("反向范围按提交前谱序摘要；技巧和简谱记号从实际对象定位", () => {
    const document = omissionFixture();
    const range = createHistoryEntry("range", document, {
      type: C.SetBeatKindRange, kind: "rest", range: {
        trackId: target.trackId,
        anchor: { measureId: "mvp2-measure-2", beatId: "mvp2-beat-2-1" },
        focus: { measureId: target.measureId, beatId: target.beatId },
      },
    }, []);
    expect(range.target.summary).toBe("第 1 轨 · 第 1 小节第 1 拍—第 2 小节第 1 拍");
    const technique = createHistoryEntry("technique", document, {
      type: C.RemoveTechnique, trackId: target.trackId, techniqueId: "cross-beat-technique",
    }, []);
    expect(technique.target.summary).toBe("第 1 轨 · 第 1 小节第 1 拍—第 1 小节第 5 拍");
    const mark = createHistoryEntry("mark", document, {
      type: "numbered.mark.remove", trackId: target.trackId, markId: "cross-numbered-slur",
    }, []);
    expect(mark.target.summary).toBe("第 1 轨 · 第 1 小节");
  });
});
