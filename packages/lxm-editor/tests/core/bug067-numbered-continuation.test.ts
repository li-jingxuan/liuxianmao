import { describe, expect, it } from "vitest";
import { createDocumentIdFactory, editNumberedTrack, EXAMPLE_MVP_7_2_DOCUMENT, parseNumberedSequence, validateNumberedVoice, type ILXMNumberedEvent, type ILXMNumberedVoiceCommand } from "../../src";

const note = (id: string, tick: number, base: ILXMNumberedEvent["rhythm"]["base"] = "sixteenth"): ILXMNumberedEvent => ({
  id, tick, kind: "notes", items: [{ id: `${id}-item`, token: "1" }], rhythm: { base, dots: 0 },
});
const items = (value: string) => {
  const parsed = parseNumberedSequence(value);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.items;
};
const setup = (denominator = 4) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  track.measures = [measure];
  track.numberedMarks = [];
  measure.lyrics = [];
  measure.numberedVoice = { events: [], tuplets: [] };
  measure.timeSignature = { numerator: denominator === 8 ? 6 : 4, denominator };
  measure.beats = [];
  measure.tuplets = [];
  const scope = { trackId: track.id, measureId: measure.id };
  const edit = (command: ILXMNumberedVoiceCommand) => editNumberedTrack(track, command, createDocumentIdFactory(document));
  return { track, measure, scope, edit };
};

describe("BUG067 fixed numbered continuation", () => {
  it.each([[4, "quarter", 960], [8, "eighth", 480]])("normalizes event and batch entry in denominator %i", (denominator, base, ticks) => {
    const { measure, edit, scope } = setup(denominator);
    const following = note("following", ticks);
    measure.numberedVoice.events = [note("first", 0), following];
    const result = edit({ ...scope, type: "numbered.event.set", eventId: "first", tokens: ["-"] });
    expect(result).toMatchObject({ ok: true, track: { measures: [{ numberedVoice: { events: [
      { id: "first", tick: 0, kind: "continuation", rhythm: { base, dots: 0 } }, following,
    ] } }] } });
    measure.numberedVoice.events = [];
    const batch = edit({ ...scope, type: "numbered.sequence.overwrite", startTick: 0, items: items("- 3"),
      rhythms: [{ base: "sixteenth", dots: 1 }, { base: "sixteenth", dots: 0 }], allowOverwrite: true });
    expect(batch).toMatchObject({ ok: true, sequenceTargets: [
      { startTick: 0, endTick: ticks, rhythm: { base, dots: 0 } }, { startTick: ticks, endTick: ticks + 240 },
    ] });
  });

  it("resumes inherited batch timing inside the space released by a shortened event", () => {
    const { measure, edit, scope } = setup();
    measure.numberedVoice.events = [note("first", 0, "half"), note("following", 1920)];
    const result = edit({ ...scope, type: "numbered.sequence.set", eventId: "first", items: items("- 3"), allowOverwrite: true });
    expect(result).toMatchObject({ ok: true, sequenceTargets: [{ startTick: 0, endTick: 960 }, { startTick: 960, endTick: 1920 }] });
  });

  it("can shorten the last explicit event of a batch without moving later notes", () => {
    const { measure, edit, scope } = setup();
    const following = note("following", 2880);
    measure.numberedVoice.events = [note("first", 0, "quarter"), note("second", 960, "half"), following];
    expect(edit({ ...scope, type: "numbered.sequence.set", eventId: "first", items: items("3 -"), allowOverwrite: true }))
      .toMatchObject({ ok: true, track: { measures: [{ numberedVoice: { events: [
        { id: "first", tick: 0 }, { id: "second", tick: 960, kind: "continuation", rhythm: { base: "quarter", dots: 0 } }, following,
      ] } }] } });
  });

  it.each(["numbered.sequence.insert", "numbered.range.replace"] as const)("normalizes explicit input in %s", (type) => {
    const { edit, scope } = setup(8);
    const range = { ...scope, startTick: 0, endTick: 480, items: items("-"), rhythms: [{ base: "sixteenth" as const, dots: 1 }] };
    const command = type === "numbered.range.replace" ? { ...range, type, allowOverwrite: true } : { ...range, type };
    expect(edit(command)).toMatchObject({ ok: true, track: { measures: [{ numberedVoice: { events: [
      { tick: 0, kind: "continuation", rhythm: { base: "eighth", dots: 0 } },
    ] } }] } });
    expect(edit({ ...command, endTick: 240 })).toMatchObject({ ok: false, message: expect.stringContaining("不足") });
  });

  it("protects bar ends, subsequent events, lyrics and structural anchors atomically", () => {
    const { measure, track, edit, scope } = setup();
    const command = { ...scope, type: "numbered.sequence.overwrite" as const, startTick: 0, items: items("-"), allowOverwrite: true };
    expect(edit({ ...command, startTick: 3600 })).toMatchObject({ ok: false, message: expect.stringContaining("不足") });
    measure.numberedVoice.events = [note("first", 0), note("following", 240)];
    const snapshot = structuredClone(track);
    expect(edit(command)).toMatchObject({ ok: false, message: expect.stringContaining("后续简谱事件") });
    expect(track).toEqual(snapshot);
    measure.numberedVoice.events[1] = note("following", 960);
    measure.lyrics = [{ id: "lyric", eventId: "first", verse: 1, text: "风" }];
    expect(edit({ ...command, allowOverwrite: false })).toMatchObject({ ok: false, message: expect.stringContaining("确认允许覆盖") });
    expect(edit(command)).toMatchObject({ ok: true, track: { measures: [{ lyrics: [] }] } });
    measure.numberedVoice.events.splice(1, 0, { id: "gap", tick: 240, rhythm: { base: "sixteenth", dots: 0 }, kind: "gap", items: [] });
    measure.lyrics = [{ id: "lyric", eventId: "gap", verse: 1, text: "风" }];
    expect(edit(command)).toMatchObject({ ok: false, message: expect.stringContaining("歌词") });
    measure.lyrics = [];
    track.numberedMarks = [{ id: "slur", type: "slur", fromEventId: "first", toEventId: "following" }];
    expect(edit(command)).toMatchObject({ ok: false, code: "NUMBERED_IMPACT_REQUIRED", removedMarkIds: ["slur"] });
    expect(edit({ ...command, confirmedRemovedMarkIds: ["slur"] })).toMatchObject({ ok: true, track: { numberedMarks: [] } });
    measure.numberedVoice.events = [note("first", 0), note("following", 240), note("end", 960)];
    track.numberedMarks = [{ id: "slur", type: "slur", fromEventId: "following", toEventId: "end" }];
    expect(edit({ ...command, confirmedRemovedMarkIds: ["slur"] })).toMatchObject({ ok: false, message: expect.stringContaining("简谱记号") });
  });

  it("keeps imported dotted continuations readable and blocks direct retiming", () => {
    const { measure, edit, scope } = setup();
    measure.numberedVoice.events = [{ id: "legacy", tick: 0, kind: "continuation", items: [{ id: "dash", token: "-" }], rhythm: { base: "sixteenth", dots: 1 } }];
    expect(validateNumberedVoice(measure.numberedVoice, 3840)).toBeNull();
    expect(edit({ ...scope, type: "numbered.event.setRhythm", eventId: "legacy", rhythm: { base: "quarter", dots: 0 } }))
      .toMatchObject({ ok: false, message: expect.stringContaining("不能调整时值或添加附点") });
    expect(edit({ ...scope, type: "numbered.sequence.set", eventId: "legacy", items: items("-"), allowOverwrite: true }))
      .toMatchObject({ ok: true, changed: false });
  });
});
