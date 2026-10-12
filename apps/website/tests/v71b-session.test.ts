import { describe, it, expect, vi } from "vitest";
import {
  EXAMPLE_MVP_6_DOCUMENT,
  LXMScoreCommandEnum,
  createTuningPreset,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";

describe("v7.1-B 会话、历史与通知", () => {
  it("范围复制为单条历史；撤销重做、重复复制和独立实例保真", () => {
    const onChange = vi.fn();
    const session = createEditorSession(EXAMPLE_MVP_6_DOCUMENT, { onChange });
    const isolated = createEditorSession(EXAMPLE_MVP_6_DOCUMENT);
    const original = session.getState().document!;
    const track = original.score.tracks[0]!;
    const command = {
      type: LXMScoreCommandEnum.CopyMeasureRange as const,
      trackId: track.id,
      sourceStartMeasureId: track.measures[0]!.id,
      sourceEndMeasureId: track.measures[1]!.id,
      afterMeasureId: track.measures.at(-1)!.id,
    };
    session.getState().execute(command);
    const copied = session.getState().document;
    expect(session.getState().historyDepth.past).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      onChange.mock.calls[0]![0].effects.some(
        (e: { kind: string }) => e.kind === "measures.copied",
      ),
    ).toBe(true);
    session.getState().undo();
    expect(session.getState().document).toEqual(original);
    session.getState().redo();
    expect(session.getState().document).toEqual(copied);
    session.getState().execute(command);
    expect(session.getState().document!.score.tracks[0]!.measures).toHaveLength(
      track.measures.length + 4,
    );
    expect(isolated.getState().document).toEqual(original);
    session
      .getState()
      .execute({ ...command, afterMeasureId: track.measures[0]!.id });
    expect(session.getState().historyDepth.past).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(4);
  });
  it("调弦、capo、标记分别进入历史；非法命令不通知", () => {
    const onChange = vi.fn();
    const session = createEditorSession(EXAMPLE_MVP_6_DOCUMENT, { onChange });
    const track = session.getState().document!.score.tracks[0]!;
    session
      .getState()
      .execute({
        type: LXMScoreCommandEnum.SetTuning,
        trackId: track.id,
        tuning: createTuningPreset("dropD"),
      });
    session
      .getState()
      .execute({
        type: LXMScoreCommandEnum.SetCapo,
        trackId: track.id,
        capo: 2,
      });
    session
      .getState()
      .execute({
        type: LXMScoreCommandEnum.SetSectionLabel,
        trackId: track.id,
        measureId: track.measures[0]!.id,
        label: "主歌",
      });
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(session.getState().historyDepth.past).toBe(3);
    session
      .getState()
      .execute({
        type: LXMScoreCommandEnum.SetCapo,
        trackId: track.id,
        capo: 13,
      });
    expect(onChange).toHaveBeenCalledTimes(3);
    session.getState().undo();
    expect(
      session.getState().document!.score.tracks[0]!.measures[0]!.sectionLabel,
    ).toBeUndefined();
  });
});
