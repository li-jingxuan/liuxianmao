import { describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT,
  LXMScoreCommandEnum,
  createCollapsedTabCellSelection,
  getFirstTabCellReference,
} from "@liuxianmao/lxm-editor";
import {
  createEditorSession,
  type EditorChangeEvent,
} from "../stores/editor-store";

const input = EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT;
const copyCommand = {
  type: LXMScoreCommandEnum.CopyMeasure as const,
  trackId: input.score.tracks[0]!.id,
  measureId: input.score.tracks[0]!.measures[0]!.id,
};

describe("编辑器宿主会话契约", () => {
  it("仅命令、撤销与重做提交后通知；替换、选择和 no-op 无回发", () => {
    const events: EditorChangeEvent[] = [];
    const session = createEditorSession(input, {
      onChange: (event) => {
        expect(session.getState().document).toBe(event.document);
        events.push(event);
      },
    });
    expect(events).toHaveLength(0);
    const first = getFirstTabCellReference(session.getState().document!)!;
    session.getState().setSelection(createCollapsedTabCellSelection(first));
    const beat = input.score.tracks[0]!.measures[0]!.beats[0]!;
    session.getState().execute({
      type: LXMScoreCommandEnum.SetBeatRhythm,
      ...first,
      rhythm: beat.rhythm,
    });
    expect(events).toHaveLength(0);
    session.getState().execute(copyCommand);
    session.getState().undo();
    session.getState().redo();
    expect(events.map((event) => event.reason)).toEqual([
      "command",
      "undo",
      "redo",
    ]);
    session.getState().replaceDocument(input);
    expect(events).toHaveLength(3);
  });

  it("同 ID 外部替换清空历史、焦点与影响，并更新会话版本", () => {
    const session = createEditorSession(input);
    const first = getFirstTabCellReference(session.getState().document!)!;
    session.getState().setSelection(createCollapsedTabCellSelection(first));
    session
      .getState()
      .setSelectedTechniqueId(input.score.tracks[0]!.techniques[0]!.id);
    session.getState().execute(copyCommand);
    const previousVersion = session.getState().sessionVersion;
    const replaced = session.getState().replaceDocument(input);
    expect(replaced.ok).toBe(true);
    expect(session.getState()).toMatchObject({
      sessionVersion: previousVersion + 1,
      selection: null,
      selectedTechniqueId: null,
      effects: [],
      errorMessage: null,
      canUndo: false,
      canRedo: false,
      historyDepth: { past: 0, future: 0 },
    });
    expect(session.getState().document).toEqual(input);
  });

  it("非法与多轨输入不改变文档、历史、选区及会话版本", () => {
    const onError = vi.fn();
    const session = createEditorSession(input, { onError });
    session.getState().execute(copyCommand);
    const before = session.getState();
    const invalid = structuredClone(input);
    invalid.score.tracks.push({
      ...invalid.score.tracks[0]!,
      id: "other-track",
      measures: [],
      techniques: [],
    });
    for (const value of ["{", invalid, undefined]) {
      expect(session.getState().replaceDocument(value).ok).toBe(false);
      expect(session.getState().document).toBe(before.document);
      expect(session.getState().history).toBe(before.history);
      expect(session.getState().selection).toBe(before.selection);
      expect(session.getState().sessionVersion).toBe(before.sessionVersion);
    }
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it("空小节轨道与循环对象输入有明确错误；空初始会话可被合法替换恢复", () => {
    const empty = structuredClone(input);
    empty.score.tracks[0]!.measures = [];
    empty.score.tracks[0]!.techniques = [];
    const session = createEditorSession(empty);
    expect(session.getState().document).toBeNull();
    expect(session.getState().errorMessage).toContain("单轨");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(session.getState().replaceDocument(cyclic)).toMatchObject({
      ok: false,
      errors: ["文档无法序列化为 JSON。"],
    });
    expect(session.getState().replaceDocument(input).ok).toBe(true);
    expect(session.getState().errorMessage).toBeNull();
  });

  it("宿主两个回调都抛错时，已经提交的编辑和历史仍保留", () => {
    const session = createEditorSession(input, {
      onChange: () => {
        throw new Error("host");
      },
      onError: () => {
        throw new Error("host error");
      },
    });
    expect(() => session.getState().execute(copyCommand)).not.toThrow();
    expect(session.getState().historyDepth.past).toBe(1);
    expect(session.getState().document!.score.tracks[0]!.measures).toHaveLength(
      15,
    );
    expect(session.getState().errorMessage).toContain("编辑结果已保留");
  });

  it("不同会话实例身份、文档和历史相互独立", () => {
    const first = createEditorSession(input);
    const second = createEditorSession(input);
    first.getState().execute(copyCommand);
    expect(first.getState().sessionId).not.toBe(second.getState().sessionId);
    expect(second.getState().document).toEqual(input);
    expect(second.getState().historyDepth.past).toBe(0);
    second.getState().replaceDocument(input);
    expect(first.getState().historyDepth.past).toBe(1);
  });

  it("复制影响只属于单次提交，撤销重做不生成第二条历史", () => {
    const session = createEditorSession(input);
    const track = input.score.tracks[0]!;
    session
      .getState()
      .execute({ ...copyCommand, measureId: track.measures[12]!.id });
    expect(
      session
        .getState()
        .effects.some((effect) => effect.kind === "technique.omitted"),
    ).toBe(true);
    expect(session.getState().historyDepth.past).toBe(1);
    session.getState().undo();
    expect(session.getState().document).toEqual(input);
    expect(session.getState().effects).toEqual([]);
    session.getState().redo();
    expect(session.getState().historyDepth.past).toBe(1);
    expect(session.getState().effects).toEqual([]);
  });

  it("错误命令通知 onError，成功 no-op 清空旧影响与错误", () => {
    const onError = vi.fn();
    const session = createEditorSession(input, { onError });
    session.getState().execute({ ...copyCommand, measureId: "missing" });
    expect(onError).toHaveBeenCalledOnce();
    expect(session.getState().historyDepth.past).toBe(0);
    const first = getFirstTabCellReference(session.getState().document!)!;
    session.getState().execute({
      type: LXMScoreCommandEnum.SetBeatRhythm,
      ...first,
      rhythm: input.score.tracks[0]!.measures[0]!.beats[0]!.rhythm,
    });
    expect(session.getState().errorMessage).toBeNull();
    expect(session.getState().effects).toEqual([]);
  });
});
