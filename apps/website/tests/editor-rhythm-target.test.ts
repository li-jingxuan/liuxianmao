import { describe, expect, it } from "vitest";
import { type ILXMRhythm } from "@liuxianmao/lxm-editor";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { resolveEditorRhythmTarget } from "../../../packages/lxm-editor-react/src/EditorShell/tools/editor-rhythm-target";
import type { MusicTextTarget } from "../../../packages/lxm-editor-react/src/EditorShell/music-text/music-text-draft";
import { createEditorSessionStore as createEditorSession } from "../../../packages/lxm-editor-react/src/stores/editor-store";

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
  it("工具栏禁用延音时值，保留旧谱书写值", () => {
    const doc = structuredClone(document);
    const melody = doc.score.tracks[0]!.measures[0]!.numberedVoice.events;
    melody[0] = { ...melody[0]!, kind: "continuation", items: [{ id: "legacy-dash", token: "-" }] };
    expect(resolveEditorRhythmTarget(doc, selection, {
      kind: "numbered", trackId: track.id, measureId: measure.id, eventId: event.id,
    }, preference, false)).toMatchObject({ kind: "numbered", enabled: false, rhythm: event.rhythm,
      reason: expect.stringContaining("不能调整时值或添加附点") });
  });
  it("直接点击空简谱继承同 tick 的长音与附点，显式选择仍优先", () => {
    const doc = structuredClone(document);
    const m = doc.score.tracks[0]!.measures[0]!;
    m.numberedVoice = { events: [], tuplets: [] };
    m.tuplets = [];
    m.beats = [{ ...m.beats[0]!, tick: 0, rhythm: { base: "half", dots: 1 } }];
    const active = { kind: "numbered" as const, trackId: track.id, measureId: measure.id, tick: 0, endTick: 2880 };
    expect(resolveEditorRhythmTarget(doc, selection, active, preference, false).rhythm).toEqual({ base: "half", dots: 1 });
    expect(resolveEditorRhythmTarget(doc, selection, active, preference, true).rhythm).toEqual(preference);
  });
  it("相邻事件前的窄空位让上次偏好回退，保留本格显式选择", () => {
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
    ).toEqual({ base: "eighth", dots: 0 });
    expect(
      resolveEditorRhythmTarget(shortened, selection, active, preference, true, [], null,
        { ...active, kind: "numberedTime" }).rhythm,
    ).toEqual(preference);
  });
  it("仅自动跳转的目标格覆盖上次偏好，到达后显式重选或手动重新打开时按偏好录入", () => {
    const doc = structuredClone(document);
    const firstMeasure = doc.score.tracks[0]!.measures[0]!;
    firstMeasure.lyrics = [];
    firstMeasure.numberedVoice = { events: [], tuplets: [] };
    doc.score.tracks[0]!.numberedMarks = [];
    const session = createEditorSession(doc);
    const initial = { base: "sixteenth", dots: 0 } as const;
    const target = { kind: "numberedTime", trackId: track.id, measureId: measure.id, tick: 0, endTick: 480 } as const;
    const active = { ...target, kind: "numbered" } as const;
    const resolve = (next: MusicTextTarget = active) => {
      const state = session.getState();
      return resolveEditorRhythmTarget(state.document!, selection, next, state.numberedInputRhythm,
        state.numberedInputRhythmExplicit, [], state.numberedAutoAdvance).rhythm;
    };
    session.getState().setNumberedInputRhythm(initial);
    session.getState().setNumberedSelection(target);
    session.getState().markNumberedAutoAdvance();
    expect(resolve()).toEqual({ base: "eighth", dots: 0 });
    expect(resolve({ ...active, tick: 480, endTick: 960 })).toEqual(initial);
    session.getState().setNumberedInputRhythm(initial);
    expect(resolve()).toEqual(initial);
    session.getState().markNumberedAutoAdvance();
    session.getState().setNumberedSelection(null);
    session.getState().setNumberedSelection(target);
    expect(resolve()).toEqual(initial);
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
