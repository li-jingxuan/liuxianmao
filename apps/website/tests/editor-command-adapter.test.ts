import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MOCK_DOCUMENT,
  EXAMPLE_MVP_7_2_DOCUMENT,
  LXMScoreCommandEnum,
} from "@liuxianmao/lxm-editor";
import { createEditorCommandAdapter } from "../components/EditorShell/session/editor-command-adapter";
import { createEditorModalController } from "../components/EditorShell/session/editor-modal-controller";
import { createEditorSession } from "../stores/editor-store";

describe("统一结构命令适配器", () => {
  it("简谱吞并无记号影响也先预览，取消零写入，确认后可一次撤销", async () => {
    const original = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = original.score.tracks[0]!;
    track.numberedMarks = [];
    const measure = track.measures[0]!;
    measure.numberedVoice = {
      tuplets: [],
      events: [
        {
          id: "a",
          tick: 0,
          rhythm: { base: "eighth", dots: 0 },
          kind: "notes",
          items: [{ id: "ai", token: "1" }],
        },
        {
          id: "b",
          tick: 480,
          rhythm: { base: "eighth", dots: 0 },
          kind: "notes",
          items: [{ id: "bi", token: "2" }],
        },
        ...[960, 1920, 2880].map((tick, i) => ({
          id: `c${i}`,
          tick,
          rhythm: { base: "quarter" as const, dots: 0 },
          kind: "notes" as const,
          items: [{ id: `ci${i}`, token: "3" }],
        })),
      ],
    };
    measure.lyrics = [
      { id: "test-lyric", eventId: "c0", verse: 1, text: "词" },
    ];
    const session = createEditorSession(original);
    const modals = createEditorModalController(session.getState, () => vi.fn());
    const execute = createEditorCommandAdapter(session, modals);
    const command = {
      type: "numbered.event.setRhythm" as const,
      trackId: track.id,
      measureId: measure.id,
      eventId: "a",
      rhythm: { base: "quarter" as const, dots: 0 },
      timeline: "preservePositions" as const,
    };
    const cancelled = execute(command);
    expect(modals.getSnapshot()?.request.message).toContain("将合并第1拍、第1拍 + 1/2，确认修改吗？");
    await modals.close(modals.getSnapshot()!.id, "cancel");
    modals.restoreFocus();
    expect(await cancelled).toMatchObject({ status: "cancelled" });
    expect(session.getState().document).toEqual(original);
    expect(session.getState().historyDepth.past).toBe(0);
    const pending = execute(command);
    expect(modals.getSnapshot()?.request.title).toBe("简谱时值影响确认");
    expect(session.getState().historyDepth.past).toBe(0);
    await modals.confirm(modals.getSnapshot()!.id);
    expect(await pending).toMatchObject({ status: "applied" });
    expect(session.getState().historyDepth.past).toBe(1);
    expect(
      session
        .getState()
        .document!.score.tracks[0]!.measures[0]!.numberedVoice.events.map(
          (e) => e.tick,
        ),
    ).toEqual([0, 960, 1920, 2880]);
    session.getState().undo();
    expect(session.getState().document!.score.tracks[0]!.measures[0]!).toEqual(
      measure,
    );
  });
  it("安全缩短或延长到空白直接提交，无空正文确认弹窗", async () => {
    const original = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = original.score.tracks[0]!;
    track.numberedMarks = [];
    const measure = track.measures[0]!;
    measure.lyrics = [];
    const first = measure.numberedVoice.events[0]!;
    measure.numberedVoice = { events: [{ ...first, tick: 0, rhythm: { base: "quarter", dots: 0 } }], tuplets: [] };
    const session = createEditorSession(original);
    const modals = createEditorModalController(session.getState, () => vi.fn());
    const execute = createEditorCommandAdapter(session, modals);
    for (const base of ["eighth", "quarter"] as const) {
      expect(await execute({ type: "numbered.event.setRhythm", trackId: track.id, measureId: measure.id, eventId: first.id, rhythm: { base, dots: 0 } })).toMatchObject({ status: "applied" });
      expect(modals.getSnapshot()).toBeNull();
    }
  });
  it("吞并带歌词的空位仍显示实际拍位并要求确认，取消无变化", async () => {
    const original = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = original.score.tracks[0]!;
    track.numberedMarks = [];
    const measure = track.measures[0]!;
    const first = measure.numberedVoice.events[0]!;
    measure.numberedVoice = { events: [
      { ...first, tick: 0, rhythm: { base: "eighth", dots: 0 } },
      { id: "lyric-gap", tick: 480, kind: "gap", rhythm: { base: "eighth", dots: 0 }, items: [] },
    ], tuplets: [] };
    measure.lyrics = [{ id: "gap-lyric", eventId: "lyric-gap", verse: 2, text: "留" }];
    const session = createEditorSession(original);
    const modals = createEditorModalController(session.getState, () => vi.fn());
    const execute = createEditorCommandAdapter(session, modals);
    const pending = execute({ type: "numbered.event.setRhythm", trackId: track.id, measureId: measure.id, eventId: first.id, rhythm: { base: "quarter", dots: 0 } });
    expect(modals.getSnapshot()?.request.message).toContain("将合并第1拍、第1拍 + 1/2，确认修改吗？");
    expect(session.getState().historyDepth.past).toBe(0);
    await modals.close(modals.getSnapshot()!.id, "cancel");
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect(session.getState().document).toEqual(original);
  });

  it("无影响的范围复制直接提交且只产生一条历史", async () => {
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
    const modals = createEditorModalController(session.getState, () => vi.fn());
    const execute = createEditorCommandAdapter(session, modals);
    const track = session.getState().document!.score.tracks[0]!;
    const result = await execute({
      type: LXMScoreCommandEnum.CopyMeasureRange,
      trackId: track.id,
      sourceStartMeasureId: track.measures[0]!.id,
      sourceEndMeasureId: track.measures[0]!.id,
      afterMeasureId: track.measures[0]!.id,
    });
    expect(result.status).toBe("applied");
    expect(modals.getSnapshot()).toBeNull();
    expect(session.getState().historyDepth.past).toBe(1);
  });

  it.each([
    ["原示例", EXAMPLE_MVP_7_2_DOCUMENT],
    ["当前默认 mock", DEFAULT_MOCK_DOCUMENT],
  ])("%s：删除立即生效，仍检查草稿、弹窗和实时目标，且可一次撤销", async (_name, document) => {
    const session = createEditorSession(document);
    const original = session.getState().document!;
    const track = original.score.tracks[0]!;
    const modals = createEditorModalController(session.getState, () => vi.fn());
    let dirty = false;
    const guard = () => dirty || modals.isOpen() ? "请先处理属性草稿或弹窗。" : null;
    const execute = createEditorCommandAdapter(session, modals, guard);
    const command = {
      type: LXMScoreCommandEnum.RemoveMeasure,
      trackId: track.id,
      measureId: track.measures[0]!.id,
    } as const;

    expect(await execute(command)).toMatchObject({ status: "applied" });
    expect(modals.getSnapshot()).toBeNull();
    expect(session.getState().document!.score.tracks[0]!.measures.map((m) => m.id))
      .toEqual(track.measures.slice(1).map((m) => m.id));
    expect(session.getState().historyDepth.past).toBe(1);
    session.getState().undo();
    expect(session.getState().document).toBe(original);

    expect(await execute(command, "modal", { isCurrent: () => false })).toMatchObject({ status: "blocked" });
    dirty = true;
    expect(await execute(command)).toMatchObject({ status: "blocked" });
    expect(session.getState().document).toBe(original);
    expect(session.getState().historyDepth.past).toBe(0);
  });
  it("删除含跨小节简谱连接记号的小节时一起清理，可一次撤销", async () => {
    const original = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = original.score.tracks[0]!;
    const quarter = { base: "quarter", dots: 0 } as const;
    const [first, second] = track.measures;
    first!.numberedVoice = { tuplets: [], events: [
      { id: "delete-event", kind: "notes", tick: 2880, rhythm: quarter, items: [{ id: "delete-item", token: "1" }] },
    ] };
    second!.numberedVoice = { tuplets: [], events: [
      { id: "keep-event", kind: "notes", tick: 0, rhythm: quarter, items: [{ id: "keep-item", token: "1" }] },
    ] };
    first!.lyrics = [];
    second!.lyrics = [];
    track.numberedMarks = [{ id: "remove-tie", type: "tie", fromItemId: "delete-item", toItemId: "keep-item" }];
    const session = createEditorSession(original);
    const modals = createEditorModalController(session.getState, () => vi.fn());
    const execute = createEditorCommandAdapter(session, modals);
    const result = await execute({
      type: LXMScoreCommandEnum.RemoveMeasure, trackId: track.id, measureId: track.measures[0]!.id,
    });
    expect(result.status).toBe("applied");
    expect(modals.getSnapshot()).toBeNull();
    expect(session.getState().historyDepth.past).toBe(1);
    expect(session.getState().document!.score.tracks[0]!.measures).toHaveLength(track.measures.length - 1);
    expect(session.getState().document!.score.tracks[0]!.numberedMarks).toEqual([]);
    session.getState().undo();
    expect(session.getState().document).toEqual(original);
  });

  it("命令层也禁止删除最后一个小节", async () => {
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
    const original = session.getState().document!;
    const track = original.score.tracks[0]!;
    const modals = createEditorModalController(session.getState, () => vi.fn());
    const execute = createEditorCommandAdapter(session, modals);
    for (const measure of track.measures.slice(1))
      expect(await execute({ type: LXMScoreCommandEnum.RemoveMeasure, trackId: track.id, measureId: measure.id }))
        .toMatchObject({ status: "applied" });
    const beforeLast = session.getState().document;
    expect(await execute({ type: LXMScoreCommandEnum.RemoveMeasure, trackId: track.id, measureId: track.measures[0]!.id }))
      .toMatchObject({ status: "blocked", message: "至少需要保留一个小节" });
    expect(session.getState().document).toBe(beforeLast);
    expect(session.getState().historyDepth.past).toBe(track.measures.length - 1);
    expect(modals.getSnapshot()).toBeNull();
  });
});
