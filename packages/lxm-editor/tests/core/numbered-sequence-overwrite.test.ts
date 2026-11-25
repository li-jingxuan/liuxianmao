import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  createDocumentIdFactory,
  editNumberedTrack,
  applyScoreCommand,
  planNumberedSequenceOverwrite,
  planNumberedSequenceSlots,
  numberedRhythmForBlockedInputPreference,
  parseNumberedSequence,
  type ILXMNumberedEvent,
} from "../../src";

const note = (id: string, tick: number, base: ILXMNumberedEvent["rhythm"]["base"] = "sixteenth"): ILXMNumberedEvent => ({
  id, tick, rhythm: { base, dots: 0 }, kind: "notes", items: [{ id: `${id}-item`, token: "1" }],
});

describe("BUG-064 continuous input across empty placeholders", () => {
  const eighthAt = (trackId: string, measureId: string, startTick: number) => ({
    type: "numbered.sequence.overwrite" as const, trackId, measureId, startTick,
    allowOverwrite: false, items: [{ kind: "set" as const, tokens: ["1"] }],
    rhythms: [{ base: "eighth" as const, dots: 0 }],
  });
  const gap: ILXMNumberedEvent = { id: "gap", tick: 2160, kind: "gap", items: [], rhythm: { base: "eighth", dots: 0 } };

  it.each([
    [1920, 2400], // 从隐式空白开始录入，保留显式空格的尾段。
    [2400, 2160], // 从显式空格内部开始录入，保留其前段。
  ])("writes an eighth at %i and keeps the gap fragment at %i", (startTick, remainderTick) => {
    const { document, track, measure } = fixture();
    const before = note("before", 1680);
    const after = note("after", 2880, "quarter");
    measure.numberedVoice.events = [before, gap, after];
    measure.lyrics = [{ id: "lyric", eventId: after.id, verse: 1, text: "风" }];
    track.numberedMarks = [{ id: "slur", type: "slur", fromEventId: before.id, toEventId: after.id }];
    const result = applyScoreCommand(document, eighthAt(track.id, measure.id, startTick));
    if (!result.ok) throw new Error(result.message);
    const nextTrack = result.document.score.tracks[0]!;
    const nextMeasure = nextTrack.measures[0]!;
    const inserted = expect.objectContaining({ tick: startTick, kind: "notes", rhythm: { base: "eighth", dots: 0 }, items: [expect.objectContaining({ token: "1" })] });
    const remainder = { ...gap, tick: remainderTick, rhythm: { base: "sixteenth", dots: 0 } };
    expect(nextMeasure.numberedVoice.events).toEqual(startTick < remainderTick
      ? [before, inserted, remainder, after]
      : [before, remainder, inserted, after]);
    expect(nextMeasure.lyrics).toEqual(measure.lyrics);
    expect(nextTrack.numberedMarks).toEqual(track.numberedMarks);
  });

  it("leaves a fragment with no exact rhythm as implicit blank", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [{ ...gap, tick: 1930 }, note("later", 2880, "quarter")];
    const result = applyScoreCommand(document, eighthAt(track.id, measure.id, 1920));
    if (!result.ok) throw new Error(result.message);
    const nextMeasure = result.document.score.tracks[0]!.measures[0]!;
    expect(nextMeasure.numberedVoice.events.map(event => [event.tick, event.kind])).toEqual([[1920, "notes"], [2880, "notes"]]);
    expect(planNumberedSequenceSlots(nextMeasure)).toContainEqual(expect.objectContaining({ startTick: 2400, endTick: 2640 }));
  });

  it("keeps both blank intervals when input falls inside one explicit gap", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [{ ...gap, tick: 1920, rhythm: { base: "quarter", dots: 0 } }, note("later", 2880, "quarter")];
    const result = applyScoreCommand(document, eighthAt(track.id, measure.id, 2160));
    if (!result.ok) throw new Error(result.message);
    const events = result.document.score.tracks[0]!.measures[0]!.numberedVoice.events;
    expect(events.map(event => [event.tick, event.kind, event.rhythm.base])).toEqual([
      [1920, "gap", "sixteenth"], [2160, "notes", "eighth"], [2640, "gap", "sixteenth"], [2880, "notes", "quarter"],
    ]);
    expect(events[0]?.id).toBe(gap.id);
  });

  it("rejects partial overwrite of notes, rests, lyric gaps, and tuplet gaps", () => {
    const { track, measure } = fixture();
    const command = { ...eighthAt(track.id, measure.id, 1920), allowOverwrite: true };
    measure.numberedVoice.events = [note(gap.id, gap.tick, "eighth")];
    expect(planNumberedSequenceOverwrite(track, command).ok).toBe(false);
    measure.numberedVoice.events = [{ ...gap, kind: "rest", items: [{ id: "rest-item", token: "0" }] }];
    expect(planNumberedSequenceOverwrite(track, command).ok).toBe(false);
    measure.numberedVoice.events = [gap];
    measure.lyrics = [{ id: "gap-lyric", eventId: gap.id, verse: 1, text: "风" }];
    expect(planNumberedSequenceOverwrite(track, command).ok).toBe(false);
    expect(planNumberedSequenceOverwrite(track, { ...command, startTick: 2400 }).ok).toBe(false);
    measure.lyrics = [];
    measure.numberedVoice.events.push(note("middle", 2480, "eighth"), note("last", 2800, "eighth"));
    measure.numberedVoice.tuplets = [{ id: "triplet", eventIds: [gap.id, "middle", "last"], ratio: { actual: 3, normal: 2 } }];
    expect(planNumberedSequenceOverwrite(track, command).ok).toBe(false);
  });
});
const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.numberedMarks = [];
  track.techniques = [];
  const measure = track.measures[0]!;
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.lyrics = [];
  measure.chordSymbols = [];
  measure.numberedVoice = { events: [note("first", 0), note("later", 960, "quarter"), note("last", 1920, "half")], tuplets: [] };
  measure.beats = Array.from({ length: 16 }, (_, index) => ({ id: `tab-${index}`, tick: index * 240, kind: "rest" as const, notes: [], rhythm: { base: "sixteenth" as const, dots: 0 } }));
  measure.tuplets = [];
  return { document, track, measure };
};

describe("BUG-070 附点旁边的虚拟空格", () => {
  it("加点填满空格，减点释放空格，补音保留有歌词及圆滑线的后音", () => {
    const { document, track, measure } = fixture();
    const first = note("first", 2880);
    const after = note("after", 3240, "eighth");
    measure.numberedVoice.events = [first, after];
    measure.lyrics = [{ id: "lyric", eventId: after.id, verse: 1, text: "词" }];
    track.numberedMarks = [{ id: "slur", type: "slur", fromEventId: first.id, toEventId: after.id }];
    const toggleDot = (current: typeof document, dots: number) => {
      const result = applyScoreCommand(current, { type: "numbered.event.setRhythm", trackId: track.id,
        measureId: measure.id, eventId: first.id, rhythm: { base: "sixteenth", dots } });
      if (!result.ok) throw new Error(result.message);
      return result.document;
    };
    const dotted = toggleDot(document, 1);
    expect(dotted.score.tracks[0]!.measures[0]!.numberedVoice.events).toEqual([
      { ...first, rhythm: { ...first.rhythm, dots: 1 } }, after,
    ]);
    const undotted = toggleDot(dotted, 0);
    expect(undotted.score).toEqual(document.score);
    expect(numberedRhythmForBlockedInputPreference(measure, 3120, 3240, after.rhythm)).toEqual({ base: "thirtySecond", dots: 0 });
    expect(numberedRhythmForBlockedInputPreference(measure, 3120, 3360, after.rhythm)).toBeUndefined();
    expect(numberedRhythmForBlockedInputPreference(measure, 0, 240, after.rhythm)).toBeUndefined();
    const command = { type: "numbered.sequence.overwrite" as const, trackId: track.id, measureId: measure.id,
      startTick: 3120, items: [{ kind: "set" as const, tokens: ["6"] }], allowOverwrite: true };
    expect(applyScoreCommand(undotted, { ...command, rhythms: [after.rhythm] })).toMatchObject({
      ok: false, message: "所选时值会占用后面的简谱音符。请缩短时值或取消附点。",
    });
    const filled = applyScoreCommand(undotted, command);
    if (!filled.ok) throw new Error(filled.message);
    const next = filled.document.score.tracks[0]!;
    expect(next.measures[0]!.numberedVoice.events).toEqual([
      first, expect.objectContaining({ tick: 3120, rhythm: { base: "thirtySecond", dots: 0 } }), after,
    ]);
    expect(next.measures[0]!.lyrics).toEqual(measure.lyrics);
    expect(next.numberedMarks).toEqual(track.numberedMarks);
  });

  it("每一项独立继承旧时值，遇到后音前的短空位时回退，保留歌词和圆滑线", () => {
    const { document, track, measure } = fixture();
    const before = note("before", 2160);
    const after = note("after", 3000, "eighth");
    measure.numberedVoice.events = [before, after];
    measure.lyrics = [{ id: "lyric", eventId: after.id, verse: 1, text: "词" }];
    track.numberedMarks = [{ id: "slur", type: "slur", fromEventId: before.id, toEventId: after.id }];
    const command = { type: "numbered.sequence.overwrite" as const, trackId: track.id, measureId: measure.id,
      startTick: 2400, items: ["2", "3"].map(token => ({ kind: "set" as const, tokens: [token] })), allowOverwrite: true };
    const snapshot = structuredClone(document);
    expect(applyScoreCommand(document, { ...command, rhythms: [after.rhythm, after.rhythm] })).toMatchObject({
      ok: false, message: "所选时值会占用后面的简谱音符。请缩短时值或取消附点。",
    });
    const result = applyScoreCommand(document, { ...command, preferredRhythm: after.rhythm });
    if (!result.ok) throw new Error(result.message);
    const next = result.document.score.tracks[0]!;
    expect(next.measures[0]!.numberedVoice.events).toEqual([
      before, expect.objectContaining({ tick: 2400, rhythm: after.rhythm }),
      expect.objectContaining({ tick: 2880, rhythm: { base: "thirtySecond", dots: 0 } }), after,
    ]);
    expect(next.measures[0]!.lyrics).toEqual(measure.lyrics);
    expect(next.numberedMarks).toEqual(track.numberedMarks);
    expect(document).toEqual(snapshot);
  });

  it("旧时值停在虚拟格内部时可继续补音，精确写到小节末尾", () => {
    const { track, measure } = fixture();
    measure.numberedVoice.events = [note("before", 3360)];
    measure.beats = [];
    const command = { measureId: measure.id, startTick: 3600, allowOverwrite: true,
      items: ["2", "3"].map(token => ({ kind: "set" as const, tokens: [token] })) };
    const short = { base: "thirtySecond", dots: 0 } as const;
    expect(planNumberedSequenceOverwrite(track, { ...command, preferredRhythm: short })).toMatchObject({
      ok: true, targets: [{ startTick: 3600, endTick: 3720, rhythm: short }, { startTick: 3720, endTick: 3840, rhythm: short }],
    });
    const tail = { ...command, startTick: 3600, items: command.items.slice(0, 1) };
    expect(planNumberedSequenceOverwrite(track, { ...tail, preferredRhythm: { base: "sixteenth", dots: 1 } })).toMatchObject({
      ok: true, targets: [{ startTick: 3600, endTick: 3840, rhythm: { base: "sixteenth", dots: 0 } }],
    });
    expect(planNumberedSequenceOverwrite(track, { ...tail, rhythms: [{ base: "sixteenth", dots: 1 }] })).toMatchObject({
      ok: false, message: "所选时值超出本小节末尾。请缩短时值或取消附点。",
    });
  });

  it("补音禁止覆盖时，手选时值完整盖住后音或对齐后音起点也不能改写", () => {
    const { track, measure } = fixture();
    measure.numberedVoice.events = [note("after", 3240, "sixteenth")];
    const command = { measureId: measure.id, startTick: 3120, allowOverwrite: false,
      items: [{ kind: "set" as const, tokens: ["6"] }] };
    expect(planNumberedSequenceOverwrite(track, { ...command, rhythms: [{ base: "eighth", dots: 0 }] })).toMatchObject({
      ok: false, message: "所选时值会占用后面的简谱音符。请缩短时值或取消附点。",
    });
    expect(planNumberedSequenceOverwrite(track, { ...command, items: [...command.items, ...command.items],
      rhythms: [{ base: "thirtySecond", dots: 0 }, { base: "sixteenth", dots: 0 }] })).toMatchObject({
      ok: false, message: "输入会改写后面的简谱音符。请减少输入，或单独编辑该位置。",
    });
  });
});

describe("BUG017/020 continuous overwrite", () => {
  it("consumes virtual sixteenths before the following real quarter", () => {
    const { document, track, measure } = fixture();
    const candidate = editNumberedTrack(track, {
      type: "numbered.sequence.set", trackId: track.id, measureId: measure.id, eventId: "first", allowOverwrite: true,
      items: ["2", "3", "3"].map(token => ({ kind: "set", tokens: [token] })),
    }, createDocumentIdFactory(document));
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(candidate.track.measures[0]!.numberedVoice.events.map(event => [event.tick, event.rhythm.base, event.items[0]?.token])).toEqual([
      [0, "sixteenth", "2"], [240, "sixteenth", "3"], [480, "sixteenth", "3"], [960, "quarter", "1"], [1920, "half", "1"],
    ]);
  });

  it("retains mixed eighth/sixteenth rhythms, IDs, lyrics and valid ties/slurs", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [note("a", 0, "eighth"), note("b", 480), note("c", 720), note("later", 960, "half")];
    measure.lyrics = [{ id: "lyric", eventId: "a", verse: 1, text: "风" }];
    track.numberedMarks = [{ id: "slur", type: "slur", fromEventId: "a", toEventId: "c" }];
    const command = { type: "numbered.sequence.set" as const, trackId: track.id, measureId: measure.id, eventId: "a", allowOverwrite: true, items: parseNumberedSequence("5 6 7") };
    if (!command.items.ok) throw new Error("parse");
    const candidate = editNumberedTrack(track, { ...command, items: command.items.items }, createDocumentIdFactory(document));
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(candidate.track.measures[0]!.numberedVoice.events.slice(0, 3)).toEqual(measure.numberedVoice.events.slice(0, 3).map((event, index) => ({ ...event, items: [{ ...event.items[0]!, token: String(index + 5) }] })));
    expect(candidate.track.measures[0]!.lyrics).toEqual(measure.lyrics);
    expect(candidate.track.numberedMarks).toEqual(track.numberedMarks);
    // Equal pitches edited together retain the tie's member identities.
    track.numberedMarks = [{ id: "tie", type: "tie", fromItemId: "a-item", toItemId: "b-item" }];
    const tied = editNumberedTrack(track, { ...command, items: [{ kind: "set", tokens: ["5"] }, { kind: "set", tokens: ["5"] }] }, createDocumentIdFactory(document));
    expect(tied).toMatchObject({ ok: true, removedMarkIds: [], track: { numberedMarks: track.numberedMarks } });
  });

  it.each([false, true])("three or four inputs occupy only the first beat; four real sixteenths=%s", (real) => {
    for (const length of [3, 4]) {
      const { document, track, measure } = fixture();
      if (real) measure.numberedVoice.events.splice(1, 0, ...[240, 480, 720].map((tick, index) => note(`existing-${index}`, tick)));
      const candidate = editNumberedTrack(track, { type: "numbered.sequence.set", trackId: track.id, measureId: measure.id, eventId: "first", allowOverwrite: true, items: Array.from({ length }, () => ({ kind: "set", tokens: ["3"] })) }, createDocumentIdFactory(document));
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;
      const events = candidate.track.measures[0]!.numberedVoice.events;
      expect(events.filter(event => event.tick < length * 240).map(event => event.tick)).toEqual(Array.from({ length }, (_, i) => i * 240));
      expect(events.filter(event => event.tick >= length * 240)).toEqual(measure.numberedVoice.events.filter(event => event.tick >= length * 240));
    }
  });

  it("skips real gaps once, keeps real identities and never materializes virtual skips", () => {
    const { document, track, measure } = fixture();
    const gap: ILXMNumberedEvent = { id: "gap", tick: 240, kind: "gap", items: [], rhythm: { base: "sixteenth", dots: 0 } };
    measure.numberedVoice.events.splice(1, 0, gap);
    const candidate = editNumberedTrack(track, { type: "numbered.sequence.set", trackId: track.id, measureId: measure.id, eventId: "first", allowOverwrite: true, items: [{ kind: "skip" }, { kind: "skip" }, { kind: "skip" }, { kind: "set", tokens: ["7"] }] }, createDocumentIdFactory(document));
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(candidate.sequenceTargets?.map(target => target.startTick)).toEqual([0, 240, 480, 720]);
    expect(candidate.track.measures[0]!.numberedVoice.events.slice(0, 3)).toEqual([measure.numberedVoice.events[0], gap, expect.objectContaining({ tick: 720 })]);
  });

  it("crosses trailing blank, an empty 3/8 measure, then the next real event", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [note("first", 2880, "eighth")];
    measure.beats = [];
    const empty = structuredClone(measure);
    empty.id = "empty"; empty.timeSignature = { numerator: 3, denominator: 8 }; empty.numberedVoice.events = [];
    const last = structuredClone(measure);
    last.id = "next"; last.numberedVoice.events = [note("next-event", 0, "quarter")];
    track.measures.push(empty, last);
    const plan = planNumberedSequenceOverwrite(track, { measureId: measure.id, eventId: "first", allowOverwrite: true, items: Array.from({ length: 6 }, () => ({ kind: "set", tokens: ["5"] })) });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.targets.map(target => [target.measureId, target.startTick, target.endTick])).toEqual([
      [measure.id, 2880, 3360], [measure.id, 3360, 3840], ["empty", 0, 480], ["empty", 480, 960], ["empty", 960, 1440], ["next", 0, 960],
    ]);
    expect(editNumberedTrack(track, { type: "numbered.sequence.overwrite", trackId: track.id, measureId: measure.id, startTick: 2880, allowOverwrite: true, items: plan.targets.map(target => target.item) }, createDocumentIdFactory(document)).ok).toBe(true);
  });

  it("半拍弱起的第二个简谱音从下一小节首拍录入", () => {
    const { document, track, measure } = fixture();
    const following = structuredClone(measure);
    following.id = "following";
    following.beats.forEach(beat => { beat.id = `next-${beat.id}`; });
    following.numberedVoice.events = [];
    track.measures.push(following);
    measure.actualDurationTicks = 480;
    measure.beats = [{ ...measure.beats[0]!, rhythm: { base: "eighth", dots: 0 } }];
    measure.numberedVoice.events = [];
    const result = applyScoreCommand(document, {
      type: "numbered.sequence.overwrite", trackId: track.id, measureId: measure.id, startTick: 0,
      allowOverwrite: true, items: ["3", "5"].map(token => ({ kind: "set", tokens: [token] })),
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.document.score.tracks[0]!.measures.map(m => m.numberedVoice.events.map(e => [e.tick, e.items[0]?.token])))
      .toEqual([[[0, "3"]], [[0, "5"]]]);
  });

  it("uses actual tuplet durations and rejects explicit retiming atomically", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [0, 320, 640].map((tick, i) => note(`t${i}`, tick, "eighth"));
    measure.numberedVoice.tuplets = [{ id: "triplet", eventIds: ["t0", "t1", "t2"], ratio: { actual: 3, normal: 2 } }];
    const command = { type: "numbered.sequence.overwrite" as const, trackId: track.id, measureId: measure.id, startTick: 0, allowOverwrite: true, items: [{ kind: "set" as const, tokens: ["5"] }, { kind: "skip" as const }, { kind: "set" as const, tokens: ["7"] }] };
    const candidate = editNumberedTrack(track, command, createDocumentIdFactory(document));
    expect(candidate).toMatchObject({ ok: true, sequenceTargets: [ { endTick: 320, ratio: { actual: 3, normal: 2 } }, { endTick: 640 }, { endTick: 960 } ] });
    const before = structuredClone(document);
    expect(editNumberedTrack(track, { ...command, rhythms: command.items.map(() => ({ base: "quarter", dots: 0 })) }, createDocumentIdFactory(document))).toMatchObject({ ok: false, message: expect.stringContaining("连音") });
    expect(document).toEqual(before);
  });

  it("explicit eighths replace a quarter and preserve first identity and lyrics", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events[0] = note("first", 0, "quarter");
    measure.lyrics = [{ id: "lyric", eventId: "first", verse: 1, text: "风" }];
    const candidate = editNumberedTrack(track, { type: "numbered.sequence.overwrite", trackId: track.id, measureId: measure.id, startTick: 0, allowOverwrite: true, items: ["1", "2"].map(token => ({ kind: "set", tokens: [token] })), rhythms: [{ base: "eighth", dots: 0 }, { base: "eighth", dots: 0 }] }, createDocumentIdFactory(document));
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(candidate.track.measures[0]!.numberedVoice.events.slice(0, 2)).toMatchObject([{ id: "first", tick: 0, rhythm: { base: "eighth" }, items: [{ id: "first-item", token: "1" }] }, { tick: 480, rhythm: { base: "eighth" }, items: [{ token: "2" }] }]);
    expect(candidate.track.measures[0]!.lyrics).toEqual(measure.lyrics);
    expect(candidate.nextFocus).toEqual({ eventId: "first" });
  });

  it("rejects unmappable lyrics/slurs, retimed skip, overlap and >256 items without partial writes", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [note("first", 0, "eighth"), note("second", 480, "eighth"), note("later", 960, "quarter")];
    const command = { type: "numbered.sequence.overwrite" as const, trackId: track.id, measureId: measure.id, startTick: 0, allowOverwrite: true, items: [{ kind: "set" as const, tokens: ["2"] }], rhythms: [{ base: "quarter" as const, dots: 0 }] };
    for (const linked of ["lyric", "slur"]) {
      measure.lyrics = linked === "lyric" ? [{ id: "lyric", eventId: "second", verse: 1, text: "风" }] : [];
      track.numberedMarks = linked === "slur" ? [{ id: "slur", type: "slur", fromEventId: "first", toEventId: "second" }] : [];
      const before = structuredClone(document);
      expect(editNumberedTrack(track, command, createDocumentIdFactory(document))).toMatchObject({ ok: false, message: expect.stringContaining("归属") });
      expect(document).toEqual(before);
    }
    track.numberedMarks = [];
    expect(editNumberedTrack(track, { ...command, items: [{ kind: "skip" }] }, createDocumentIdFactory(document))).toMatchObject({ ok: false, message: expect.stringContaining("跳过") });
    expect(editNumberedTrack(track, { ...command, startTick: 240 }, createDocumentIdFactory(document))).toMatchObject({ ok: false });
    expect(editNumberedTrack(track, { ...command, items: Array.from({ length: 257 }, () => ({ kind: "skip" })), rhythms: undefined }, createDocumentIdFactory(document))).toMatchObject({ ok: false });
    expect(editNumberedTrack(track, { ...command, allowOverwrite: false }, createDocumentIdFactory(document))).toMatchObject({ ok: false });
  });

  it("retains the existing confirmation gate for changed tie pitches", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [note("a", 0, "eighth"), note("b", 480, "eighth")];
    track.numberedMarks = [{ id: "tie", type: "tie", fromItemId: "a-item", toItemId: "b-item" }];
    const command = { type: "numbered.sequence.set" as const, trackId: track.id, measureId: measure.id, eventId: "a", allowOverwrite: true, items: [{ kind: "set" as const, tokens: ["5"] }] };
    expect(applyScoreCommand(document, command)).toMatchObject({ ok: false, code: "NUMBERED_IMPACT_REQUIRED", removedMarkIds: ["tie"] });
    const applied = applyScoreCommand(document, { ...command, confirmedRemovedMarkIds: ["tie"] });
    if (!applied.ok) throw new Error(`${applied.code}: ${applied.message}`);
  });

  it("accepts exactly 256 slots, rejects 257 or running past the final bar atomically", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [];
    track.measures = Array.from({ length: 16 }, (_, i) => ({ ...structuredClone(measure), id: `measure-${i}` }));
    const command = { type: "numbered.sequence.overwrite" as const, trackId: track.id, measureId: "measure-0", startTick: 0, allowOverwrite: true, items: Array.from({ length: 256 }, () => ({ kind: "set" as const, tokens: ["1"] })) };
    const before = structuredClone(document);
    const candidate = editNumberedTrack(track, command, createDocumentIdFactory(document));
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(candidate.sequenceTargets).toHaveLength(256);
    expect(candidate.sequenceAvailableTicks).toBe(16 * 3840);
    expect(candidate.track.measures.at(-1)!.numberedVoice.events.at(-1)?.tick).toBe(3600);
    expect(editNumberedTrack(track, { ...command, items: [...command.items, { kind: "skip" }] }, createDocumentIdFactory(document))).toMatchObject({ ok: false });
    expect(editNumberedTrack(track, { ...command, startTick: 240 }, createDocumentIdFactory(document))).toMatchObject({ ok: false });
    expect(document).toEqual(before);
  });

  it("preserves dotted and half-note target durations up to the exact bar end", () => {
    const { document, track, measure } = fixture();
    measure.numberedVoice.events = [{ ...note("dotted", 0, "eighth"), rhythm: { base: "eighth", dots: 1 } }, note("short", 720), note("long", 960, "half"), note("tail", 2880, "quarter")];
    const command = { type: "numbered.sequence.set" as const, trackId: track.id, measureId: measure.id, eventId: "dotted", allowOverwrite: true, items: ["2", "3", "4", "5"].map(token => ({ kind: "set" as const, tokens: [token] })) };
    const candidate = editNumberedTrack(track, command, createDocumentIdFactory(document));
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(candidate.sequenceTargets?.map(target => [target.startTick, target.endTick])).toEqual([[0, 720], [720, 960], [960, 2880], [2880, 3840]]);
    expect(candidate.track.measures[0]!.numberedVoice.events.map(event => [event.id, event.rhythm, event.tick])).toEqual(measure.numberedVoice.events.map(event => [event.id, event.rhythm, event.tick]));
  });
});
