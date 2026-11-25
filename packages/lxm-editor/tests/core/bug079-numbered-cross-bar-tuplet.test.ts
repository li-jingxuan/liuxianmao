import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  buildNumberedIndex,
  createBeatClipboard,
  createNumberedClipboard,
  createNumberedTrackRhythmContext,
  EXAMPLE_MVP_7_2_DOCUMENT,
  loadDocument,
  LXMScoreCommandEnum as C,
  planLyricPositions,
  planLyricSequence,
  planNumberedInputRanges,
  planNumberedSequenceSlots,
  previewNumberedTupletEdit,
  resolveMusicTextRange,
  type ILXMDocument,
  type ILXMNumberedEvent,
  type ILXMNumberedTupletCommand,
  type ILXMScoreCommand,
} from "../../src";

const capacity = 3840;
const eighth = { base: "eighth", dots: 0 } as const;

const note = (id: string, tick: number, tokens = ["1"]): ILXMNumberedEvent => ({
  id, tick, rhythm: eighth, kind: "notes", items: tokens.map((token, index) => ({ id: `${id}-item-${index}`, token })),
});

const execute = (document: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(result.message);
  return result.document;
};

const reload = (document: ILXMDocument) => {
  const result = loadDocument(JSON.stringify(document));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.document;
};

const fixture = (split: 1 | 2) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = track.measures.slice(0, 3);
  track.techniques = [];
  const start = capacity - split * 480;
  const members = [note("member-1", start), note("member-2", (start + 480) % capacity), note("member-3", (start + 960) % capacity, ["1", "3"])];
  const before = note("before-group", 0);
  const after = note("after-group", 1440);
  const lyrics = members.map((event, index) => ({ id: `group-lyric-${index}`, eventId: event.id, verse: 1 as const, text: `词${index}` }));
  track.measures.forEach((measure, index) => {
    measure.id = `cross-bar-test-measure-${index}`;
    measure.timeSignature = { numerator: 4, denominator: 4 };
    delete measure.actualDurationTicks;
    measure.lyrics = index === 0 ? lyrics.slice(0, split) : index === 1 ? lyrics.slice(split) : [];
    measure.chordSymbols = [];
    measure.tuplets = [];
    measure.beats = Array.from({ length: 4 }, (_, beat) => ({
      id: `cross-bar-tab-${index}-${beat}`, tick: beat * 960, rhythm: { base: "quarter", dots: 0 }, kind: "rest", notes: [], capacityRest: true,
    }));
    measure.numberedVoice = { events: index === 0 ? [before, ...members.slice(0, split)] : index === 1 ? [...members.slice(split), after] : [], tuplets: [] };
  });
  track.numberedMarks = [
    { id: "cross-bar-internal-tie", type: "tie", fromItemId: members[0]!.items[0]!.id, toItemId: members[1]!.items[0]!.id },
    { id: "cross-bar-internal-slur", type: "slur", fromEventId: members[0]!.id, toEventId: members[2]!.id },
  ];
  const [first, second] = track.measures;
  const add = { type: "numbered.tuplet.add", trackId: track.id, measureId: first!.id, eventIds: members.map(event => event.id).reverse() } satisfies ILXMNumberedTupletCommand;
  return { document, track, first: first!, second: second!, start, members, before, after, lyrics, add };
};

const removeFromSecond = (document: ILXMDocument): ILXMNumberedTupletCommand => {
  const track = document.score.tracks[0]!;
  return { type: "numbered.tuplet.remove", trackId: track.id, measureId: track.measures[1]!.id, tupletId: track.measures[0]!.numberedVoice.tuplets[0]!.id };
};

describe("BUG-079 跨小节简谱三连音", () => {
  it.each([1, 2] as const)("原首小节 %i 个成员时，实际时长均分、保持身份与歌词，并且可保存及精确还原", split => {
    const { document, track, first, second, start, members, before, after, lyrics, add } = fixture(split);
    expect(previewNumberedTupletEdit(track, add)).toEqual({ ok: true });
    const applied = applyScoreCommand(document, add);
    if (!applied.ok) throw new Error(applied.message);
    const converted = applied.document;
    expect(converted.documentRevision).toBe(document.documentRevision + 1);
    const next = converted.score.tracks[0]!;
    const [owner, following, untouched] = next.measures;
    const group = owner!.numberedVoice.tuplets[0]!;
    const ids = members.map(event => event.id);
    expect(group).toEqual({ id: expect.any(String), eventIds: ids, ratio: { actual: 3, normal: 2 }, crossBar: { nextMeasureId: second.id } });
    expect(following!.numberedVoice.tuplets).toEqual([]);
    const indexed = buildNumberedIndex(next).events;
    const placed = ids.map(id => indexed.get(id)!);
    expect(placed.map(event => [event.start, event.end])).toEqual(ids.map((_, index) => [start + index * 320, start + (index + 1) * 320]));
    expect(placed.map(event => event.measureId)).toEqual([first.id, first.id, split === 1 ? second.id : first.id]);
    expect(placed.map(entry => entry.event.items)).toEqual(members.map(member => member.items));
    expect(owner!.lyrics).toEqual(lyrics.slice(0, split === 1 ? 2 : 3));
    expect(following!.lyrics).toEqual(lyrics.slice(split === 1 ? 2 : 3));
    expect(next.numberedMarks).toEqual(track.numberedMarks);
    expect(owner!.numberedVoice.events[0]).toBe(before);
    expect(following!.numberedVoice.events.at(-1)).toBe(after);
    expect(owner!.beats).toBe(first.beats);
    expect(following!.beats).toBe(second.beats);
    expect(untouched).toBe(track.measures[2]);
    expect(applied.effects?.flatMap(effect => effect.kind === "numbered.event.resized" ? [effect.eventId] : [])).toEqual(ids);

    const loaded = reload(converted);
    expect(loaded.score).toEqual(converted.score);
    const remove = removeFromSecond(loaded);
    expect(previewNumberedTupletEdit(loaded.score.tracks[0]!, remove)).toEqual({ ok: true });
    expect(execute(loaded, remove).score).toEqual(document.score);
  });

  it("1+2 将小节线后的续响排除在简谱和歌词空槽外，批量录入从实际续响终点继续", () => {
    const { document, add, members, first, second } = fixture(1);
    const converted = execute(document, add);
    const track = converted.score.tracks[0]!;
    const context = createNumberedTrackRhythmContext(track);
    const next = track.measures[1]!;
    expect(context.incomingSustainEndTickByMeasureId.get(next.id)).toBe(160);
    expect(planNumberedInputRanges(next, 0, context).every(range => range.startTick >= 480)).toBe(true);
    expect(planNumberedSequenceSlots(next, context)[0]).toMatchObject({ eventId: members[2]!.id, startTick: 160, endTick: 480, ratio: { actual: 3, normal: 2 } });
    expect(planLyricPositions(next, context)[0]).toEqual({ eventId: members[2]!.id, tick: 160, endTick: 480 });
    const range = resolveMusicTextRange(converted, { trackId: track.id, kind: "numbered", anchor: { measureId: first.id, eventId: members[0]!.id }, focus: { measureId: second.id, eventId: members[1]!.id } });
    expect(range.ok && range.slots.map(slot => slot.eventId)).toEqual(members.slice(0, 2).map(event => event.id));
    const lyricPlan = planLyricSequence(converted, { trackId: track.id, measureId: first.id, eventId: members[1]!.id, verse: 2 }, [
      { kind: "set", text: "前" }, { kind: "set", text: "后" },
    ]);
    expect(lyricPlan.rows.map(row => row.target?.eventId)).toEqual(members.slice(1).map(event => event.id));
    const newContent = execute(converted, {
      type: "numbered.sequence.set", trackId: track.id, measureId: first.id, eventId: members[1]!.id,
      items: [{ kind: "skip" }, { kind: "set", tokens: ["2", "3"] }], allowOverwrite: true,
    });
    const changed = buildNumberedIndex(newContent.score.tracks[0]!).events.get(members[2]!.id)!;
    expect(changed).toMatchObject({ start: capacity + 160, end: capacity + 480, event: { items: [{ id: members[2]!.items[0]!.id, token: "2" }, members[2]!.items[1]] } });
    expect(applyScoreCommand(converted, { type: "numbered.sequence.overwrite", trackId: track.id, measureId: second.id, startTick: 0, rhythms: [eighth], items: [{ kind: "set", tokens: ["5"] }], allowOverwrite: true })).toMatchObject({ ok: false, message: expect.stringContaining("跨小节") });
  });

  it("原窗口被后续输入占用或次小节缩短时，预览和执行均原子拒绝还原", () => {
    const short = fixture(1);
    short.second.numberedVoice.events.pop();
    const filled = fixture(2);
    const occupied = execute(execute(filled.document, filled.add), {
      type: "numbered.sequence.insert", trackId: filled.track.id, measureId: filled.second.id,
      startTick: 0, endTick: 480, rhythms: [eighth], items: [{ kind: "set", tokens: ["5"] }],
    });
    const shortened = execute(execute(short.document, short.add), {
      type: C.SetMeasureDuration, trackId: short.track.id, measureId: short.second.id, durationTicks: 480,
    });
    for (const score of [occupied, shortened]) {
      const snapshot = JSON.stringify(score);
      const remove = removeFromSecond(score);
      const preview = previewNumberedTupletEdit(score.score.tracks[0]!, remove);
      expect(preview).toMatchObject({ ok: false, code: "NUMBERED_OVERLAP" });
      expect(applyScoreCommand(score, remove)).toEqual(preview);
      expect(JSON.stringify(score)).toBe(snapshot);
    }
  });

  it("拒绝不连续或时值不同的尾首选择及不再相接的组外延音线", () => {
    const separated = fixture(2);
    separated.second.numberedVoice.events[0]!.tick = 120;
    const mixed = fixture(1);
    mixed.second.numberedVoice.events[0]!.rhythm = { base: "sixteenth", dots: 0 };
    const linked = fixture(1);
    linked.after.tick = 960;
    linked.track.numberedMarks.push({ type: "tie", id: "last-to-outside", fromItemId: linked.members[2]!.items[0]!.id, toItemId: linked.after.items[0]!.id });
    for (const [candidate, expected] of [[separated, "时间连续"], [mixed, "书写时值"], [linked, "延音线"]] as const) {
      const preview = previewNumberedTupletEdit(candidate.track, candidate.add);
      expect(preview).toMatchObject({ ok: false, code: "NUMBERED_INVALID", message: expect.stringContaining(expected) });
      expect(applyScoreCommand(candidate.document, candidate.add)).toEqual(preview);
      expect(candidate.first.numberedVoice.tuplets).toEqual([]);
    }
  });

  it("完整小节范围复制重映射组、成员与歌词，局部剪贴板和结构修改保护组", () => {
    const { document, add, track, first, second } = fixture(1);
    const converted = execute(document, add);
    const copied = reload(execute(converted, { type: C.CopyMeasureRange, trackId: track.id, sourceStartMeasureId: first.id, sourceEndMeasureId: second.id, afterMeasureId: second.id }));
    const [originalOwner, , owner, next] = copied.score.tracks[0]!.measures;
    const group = owner!.numberedVoice.tuplets[0]!;
    const originals = originalOwner!.numberedVoice.tuplets[0]!;
    expect(group.id).not.toBe(originals.id);
    expect(group.crossBar?.nextMeasureId).toBe(next!.id);
    expect(group.eventIds).toEqual([...owner!.numberedVoice.events.slice(1), next!.numberedVoice.events[0]].map(event => event!.id));
    expect(next!.lyrics[0]).toMatchObject({ eventId: group.eventIds[2] });
    expect(next!.lyrics[0]!.id).not.toBe(second.lyrics.at(-1)!.id);
    expect(createNumberedClipboard(converted, { trackId: track.id, measureId: second.id, startTick: 0, endTick: 480 })).toMatchObject({ ok: false });
    const beatRange = { trackId: track.id, measureId: second.id, startBeatId: second.beats[0]!.id, endBeatId: second.beats[0]!.id };
    expect(createBeatClipboard(converted, beatRange)).toMatchObject({ ok: false });
    expect(createBeatClipboard(converted, { ...beatRange, layers: "tab" })).toMatchObject({ ok: true });
    expect(applyScoreCommand(converted, { type: C.CopyMeasure, trackId: track.id, measureId: second.id })).toMatchObject({ ok: false });
    expect(applyScoreCommand(converted, { type: C.RemoveMeasure, trackId: track.id, measureId: first.id })).toMatchObject({ ok: false });
    expect(applyScoreCommand(converted, { type: C.InsertMeasure, trackId: track.id, afterMeasureId: first.id })).toMatchObject({ ok: false });
  });

  it("载入时拒绝错误的次小节引用、漏成员和被外音占用的续响", () => {
    const { document, add } = fixture(1);
    const converted = execute(document, add);
    const tamper = [
      (copy: ILXMDocument) => { copy.score.tracks[0]!.measures[0]!.numberedVoice.tuplets[0]!.crossBar!.nextMeasureId = "missing-measure"; },
      (copy: ILXMDocument) => { copy.score.tracks[0]!.measures[1]!.numberedVoice.events.shift(); },
      (copy: ILXMDocument) => { copy.score.tracks[0]!.measures[1]!.numberedVoice.events.unshift(note("overlapping-event", 0)); },
    ];
    for (const update of tamper) {
      const copy = structuredClone(converted);
      update(copy);
      expect(loadDocument(JSON.stringify(copy)).ok).toBe(false);
    }
  });
});
