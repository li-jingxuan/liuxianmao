import { describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  LXMScoreCommandEnum,
} from "@liuxianmao/lxm-editor";
import { createEditorCommandAdapter } from "../components/EditorShell/editor-command-adapter";
import { createEditorModalController } from "../components/EditorShell/editor-modal-controller";
import { createEditorSession } from "../stores/editor-store";

describe("统一结构命令适配器", () => {
  it("简谱后续压缩先预览，确认后一起提交并可一次撤销", async () => {
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
    const pending = execute({
      type: "numbered.event.setRhythm",
      trackId: track.id,
      measureId: measure.id,
      eventId: "a",
      rhythm: { base: "quarter", dots: 0 },
      timeline: "editTimeline",
    });
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
    ).toEqual([0, 960, 1440, 1920, 2880]);
    session.getState().undo();
    expect(session.getState().document!.score.tracks[0]!.measures[0]!).toEqual(
      measure,
    );
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

  it("删除小节先等确认，取消不写历史，确认后一次提交", async () => {
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
    const modals = createEditorModalController(session.getState, () => vi.fn());
    const execute = createEditorCommandAdapter(session, modals);
    const track = session.getState().document!.score.tracks[0]!;
    const pending = execute({
      type: LXMScoreCommandEnum.RemoveMeasure,
      trackId: track.id,
      measureId: track.measures[0]!.id,
    });
    const modal = modals.getSnapshot();
    expect(modal?.request.kind).toBe("structure-impact");
    expect(await modals.close(modal!.id, "cancel")).toBe(true);
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect(session.getState().historyDepth.past).toBe(0);

    const second = execute({
      type: LXMScoreCommandEnum.RemoveMeasure,
      trackId: track.id,
      measureId: track.measures[0]!.id,
    });
    const nextModal = modals.getSnapshot()!;
    expect(await modals.confirm(nextModal.id)).toBe(true);
    expect(await second).toMatchObject({ status: "applied" });
    expect(session.getState().historyDepth.past).toBe(1);
  });
});
