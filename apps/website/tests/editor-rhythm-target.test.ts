import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  type ILXMRhythm,
} from "@liuxianmao/lxm-editor";
import { resolveEditorRhythmTarget } from "../components/EditorShell/editor-rhythm-target";
import { createEditorSession } from "../stores/editor-store";

describe("工具栏实际时值目标", () => {
  const document = EXAMPLE_MVP_7_2_DOCUMENT;
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const event = measure.numberedVoice.events[0]!;
  const cell = {
    trackId: track.id,
    measureId: measure.id,
    beatId: measure.beats[0]!.id,
    string: 1,
  };
  const selection = { anchor: cell, focus: cell };
  const preference: ILXMRhythm = { base: "quarter", dots: 0 };
  it("已有简谱优先于残留 TAB 选区", () => {
    expect(
      resolveEditorRhythmTarget(
        document,
        selection,
        {
          kind: "numbered",
          trackId: track.id,
          measureId: measure.id,
          eventId: event.id,
        },
        preference,
        false,
      ),
    ).toMatchObject({ kind: "numbered", enabled: true, rhythm: event.rhythm });
  });
  it("空白首次适应较短窗口，显式偏好不被静默改写", () => {
    const shortened = structuredClone(document);
    shortened.score.tracks[0]!.measures[0]!.numberedVoice.events[0]!.rhythm = {
      base: "eighth",
      dots: 0,
    };
    const active = {
      kind: "numbered" as const,
      trackId: track.id,
      measureId: measure.id,
      tick: 480,
      endTick: 960,
    };
    expect(
      resolveEditorRhythmTarget(shortened, selection, active, preference, false)
        .rhythm,
    ).toEqual({ base: "eighth", dots: 0 });
    expect(
      resolveEditorRhythmTarget(shortened, selection, active, preference, true)
        .rhythm,
    ).toEqual(preference);
  });
  it("撤销缩短后，原空白已被音符占用，清除空白选区并禁用旧工具目标", () => {
    const session = createEditorSession(document);
    session
      .getState()
      .execute({
        type: "numbered.event.setRhythm",
        trackId: track.id,
        measureId: measure.id,
        eventId: event.id,
        rhythm: { base: "eighth", dots: 0 },
        timeline: "editTimeline",
      });
    session
      .getState()
      .setNumberedSelection({
        kind: "numberedTime",
        trackId: track.id,
        measureId: measure.id,
        tick: 480,
        endTick: 960,
      });
    session.getState().undo();
    expect(session.getState().numberedSelection).toBeNull();
    expect(
      resolveEditorRhythmTarget(
        session.getState().document!,
        selection,
        {
          kind: "numbered",
          trackId: track.id,
          measureId: measure.id,
          tick: 480,
          endTick: 960,
        },
        preference,
        false,
      ).enabled,
    ).toBe(false);
  });
  it("歌词不能借用 TAB 选区修改时值；无有效对象禁用", () => {
    expect(
      resolveEditorRhythmTarget(
        document,
        selection,
        {
          kind: "lyric",
          trackId: track.id,
          measureId: measure.id,
          eventId: event.id,
        },
        preference,
        false,
      ).enabled,
    ).toBe(false);
    expect(
      resolveEditorRhythmTarget(document, null, null, preference, false)
        .enabled,
    ).toBe(false);
    expect(
      resolveEditorRhythmTarget(document, selection, null, preference, false),
    ).toMatchObject({ kind: "tab", enabled: true });
  });
});
