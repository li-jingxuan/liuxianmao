import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  createNumberedRhythmContext,
  LXM_TUPLET_RATIOS,
  loadDocument,
  previewNumberedTupletEdit,
  type ILXMDocument,
  type ILXMNumberedTupletCommand,
  type ILXMScoreCommand,
} from "../../src";

const example = readFileSync(new URL("../../example/ideal-score.lxm.json", import.meta.url), "utf8");
const beforeTuplets = JSON.parse(readFileSync(new URL("../fixtures/ideal-measure-32-before-tuplets.json", import.meta.url), "utf8"));

const getMeasure = (document: ILXMDocument) => document.score.tracks[0]!.measures[31]!;

const fixture = () => {
  const source: ILXMDocument = JSON.parse(example);
  // 新版将本小节缩短并录入两组三连音。回归用例恢复编组前的简谱、歌词与 TAB 拍点及容量。
  Object.assign(getMeasure(source), beforeTuplets);
  const loaded = loadDocument(JSON.stringify(source));
  if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
  const document = loaded.document;
  const track = document.score.tracks[0]!;
  const measure = getMeasure(document);
  const selected = measure.numberedVoice.events.slice(0, 3);
  const add = {
    type: "numbered.tuplet.add",
    trackId: track.id,
    measureId: measure.id,
    eventIds: selected.map((event) => event.id),
  } satisfies ILXMNumberedTupletCommand;
  return { document, track, measure, selected, add };
};

const execute = (document: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(result.message);
  return result.document;
};

describe("BUG-071 简谱三连音", () => {
  it("将《理想》第 32 小节三个选中音原位编组，以一条命令保留歌词、音符身份和 TAB", () => {
    const { document, track, measure, selected, add } = fixture();
    expect(selected.map((event) => event.tick)).toEqual([0, 480, 960]);
    selected[1]!.rhythm = { dots: 0, base: "eighth" };
    const reverseSelection = { ...add, eventIds: [...add.eventIds].reverse() };
    expect(previewNumberedTupletEdit(track, reverseSelection)).toEqual({ ok: true });

    const triplet = execute(document, reverseSelection);
    expect(triplet.documentRevision).toBe(document.documentRevision + 1);
    const { numberedVoice, ...otherMeasureContent } = getMeasure(triplet);
    expect(numberedVoice.events).toEqual([
      ...selected.map((event, index) => ({ ...event, tick: index * 320 })),
      ...measure.numberedVoice.events.slice(3),
    ]);
    expect(numberedVoice.tuplets).toEqual([
      { id: expect.any(String), eventIds: add.eventIds, ratio: { actual: 3, normal: 2 } },
    ]);
    const { numberedVoice: originalVoice, ...originalMeasureContent } = measure;
    expect(otherMeasureContent).toEqual(originalMeasureContent);
    expect(triplet.score.tracks[0]!.measures[30]).toEqual(track.measures[30]);
    expect(triplet.score.tracks[0]!.measures[32]).toEqual(track.measures[32]);

    const remove = {
      type: "numbered.tuplet.remove",
      trackId: add.trackId,
      measureId: add.measureId,
      tupletId: numberedVoice.tuplets[0]!.id,
    } satisfies ILXMNumberedTupletCommand;
    expect(previewNumberedTupletEdit(triplet.score.tracks[0]!, remove)).toEqual({ ok: true });
    expect(getMeasure(execute(triplet, remove)).numberedVoice).toEqual(originalVoice);
  });

  it("拒绝不足三个、重复、不在本小节、含空位或者已归组的选择", () => {
    const { document, track, measure, add } = fixture();
    const [first, second] = add.eventIds;
    for (const eventIds of [
      [first!, second!],
      [first!, second!, second!],
      [first!, second!, track.measures[30]!.numberedVoice.events[0]!.id],
      [first!, second!, measure.numberedVoice.events[3]!.id],
    ]) {
      expect(previewNumberedTupletEdit(track, { ...add, eventIds })).toMatchObject({ ok: false, code: "NUMBERED_INVALID" });
    }
    expect(applyScoreCommand(execute(document, add), add)).toMatchObject({ ok: false, message: expect.stringContaining("再次归组") });
  });

  it.each([
    { rhythms: ["eighth", "sixteenth", "eighth"] as const, message: "书写时值须一致" },
    { rhythms: ["sixteenth", "sixteenth", "sixteenth"] as const, message: "时间连续" },
  ])("拒绝书写时值不同或时间不相接的选择 $rhythms", ({ rhythms, message }) => {
    const { document, measure, add } = fixture();
    measure.numberedVoice.events.slice(0, 3).forEach((event, index) => {
      event.rhythm.base = rhythms[index]!;
    });
    expect(applyScoreCommand(document, add)).toMatchObject({ ok: false, message: expect.stringContaining(message) });
  });

  it("保留仍有效的内部延音线、连音线和延长记号", () => {
    const { document, selected, add } = fixture();
    const [first, second, third] = selected;
    const commands = [
      { type: "tie", fromItemId: first!.items[0]!.id, toItemId: second!.items[0]!.id },
      { type: "slur", fromEventId: first!.id, toEventId: third!.id },
      { type: "fermata", eventId: second!.id },
    ] as const;
    const marked = commands.reduce((current, mark) => execute(current, {
      type: "numbered.mark.add", trackId: add.trackId, mark,
    }), document);
    expect(execute(marked, add).score.tracks[0]!.numberedMarks).toEqual(marked.score.tracks[0]!.numberedMarks);
  });

  it("拒绝让组尾延音线失去连续性，预览和带确认提交都不删除记号", () => {
    const { document, measure, selected, add } = fixture();
    const filled = execute(document, {
      type: "numbered.event.set", trackId: add.trackId, measureId: add.measureId,
      eventId: measure.numberedVoice.events[3]!.id, tokens: ["4"],
    });
    const marked = execute(filled, {
      type: "numbered.mark.add", trackId: add.trackId,
      mark: {
        type: "tie", fromItemId: selected[2]!.items[0]!.id,
        toItemId: getMeasure(filled).numberedVoice.events[3]!.items[0]!.id,
      },
    });
    const track = marked.score.tracks[0]!;
    const command = { ...add, confirmedRemovedMarkIds: track.numberedMarks.map((mark) => mark.id) };
    const blocked = previewNumberedTupletEdit(track, command);
    expect(blocked).toMatchObject({ ok: false, code: "NUMBERED_INVALID", message: expect.stringContaining("延音线") });
    expect(applyScoreCommand(marked, command)).toEqual(blocked);
    expect(getMeasure(marked).numberedVoice.tuplets).toEqual([]);
  });

  it("组外空位被录入后，拒绝展开连音组以免挤占后续音符", () => {
    const { document, add } = fixture();
    const triplet = execute(document, add);
    const filled = execute(triplet, {
      type: "numbered.sequence.insert", trackId: add.trackId, measureId: add.measureId,
      startTick: 960, endTick: 1440, items: [{ kind: "set", tokens: ["5"] }],
      rhythms: [{ base: "eighth", dots: 0 }],
    });
    const voice = getMeasure(filled).numberedVoice;
    const remove = {
      type: "numbered.tuplet.remove", trackId: add.trackId, measureId: add.measureId,
      tupletId: voice.tuplets[0]!.id,
    } satisfies ILXMNumberedTupletCommand;
    const blocked = previewNumberedTupletEdit(filled.score.tracks[0]!, remove);
    expect(blocked).toMatchObject({ ok: false, code: "NUMBERED_OVERLAP", message: expect.stringContaining("重叠") });
    expect(applyScoreCommand(filled, remove)).toEqual(blocked);
    expect(voice.events.map((event) => event.tick)).toEqual([0, 320, 640, 960, 1440, 1680, 1920]);
  });

  it("移除连音时保留已有歌词的组内空位和其事件身份", () => {
    const { document, selected, add } = fixture();
    const eventId = selected[1]!.id;
    const withGap = execute(execute(document, add), {
      type: "numbered.event.remove", trackId: add.trackId, measureId: add.measureId, eventId,
    });
    const before = getMeasure(withGap);
    const restored = getMeasure(execute(withGap, {
      type: "numbered.tuplet.remove", trackId: add.trackId, measureId: add.measureId,
      tupletId: before.numberedVoice.tuplets[0]!.id,
    }));
    expect(restored.numberedVoice.events[1]).toMatchObject({ id: eventId, tick: 480, kind: "gap" });
    expect(restored.lyrics).toContainEqual(expect.objectContaining({ eventId }));
    expect(restored.lyrics).toEqual(before.lyrics);
  });
});

describe("BUG-078 简谱连音比例", () => {
  it.each(LXM_TUPLET_RATIOS)("$actual:$normal 保留事件和歌词，可重新加载并拆组", (ratio) => {
    const { document, track, measure, add } = fixture();
    const notes = Array.from({ length: ratio.actual }, (_, index) => {
      const id = `ratio-note-${index}`;
      return { kind: "notes" as const, id, tick: 240 + index * 240, rhythm: { base: "sixteenth", dots: 0 } as const,
        items: [{ id: `${id}-item`, token: "4" }] };
    });
    measure.numberedVoice = { events: notes, tuplets: [] };
    measure.lyrics = [{ id: "ratio-lyric", eventId: notes[1]!.id, verse: 1, text: "词" }];
    const command = { ...add, ratio, eventIds: notes.map(({ id }) => id).reverse() };
    expect(previewNumberedTupletEdit(track, command)).toEqual({ ok: true });
    const converted = execute(document, command);
    const reloaded = loadDocument(JSON.stringify(converted));
    if (!reloaded.ok) throw new Error(reloaded.errors.join("\n"));
    const updated = getMeasure(reloaded.document);
    const { events, tuplets } = updated.numberedVoice;
    const ticks = 240 * ratio.normal / ratio.actual;
    expect(events).toEqual(notes.map((event, index) => ({ ...event, tick: 240 + index * ticks })));
    expect(events.map(createNumberedRhythmContext(updated.numberedVoice).getEventDurationTicks))
      .toEqual(notes.map(() => ({ ok: true, ticks })));
    expect(tuplets[0]?.ratio).toEqual(ratio);
    expect(updated.lyrics).toEqual(measure.lyrics);
    const restored = execute(reloaded.document, { type: "numbered.tuplet.remove", trackId: track.id,
      measureId: measure.id, tupletId: tuplets[0]!.id });
    expect(getMeasure(restored)).toEqual(measure);
  });

  it("2:3 延长拒绝占用组外事件或越过小节，非 3:2 比例拒绝跨小节", () => {
    const { document, track, measure, selected, add } = fixture();
    const ratio = { actual: 2, normal: 3 } as const;
    const command = { ...add, eventIds: add.eventIds.slice(0, 2), ratio };
    const overlap = previewNumberedTupletEdit(track, command);
    expect(overlap).toMatchObject({ ok: false, code: "NUMBERED_OVERLAP", message: expect.stringContaining("连续空位不足") });
    expect(applyScoreCommand(document, command)).toEqual(overlap);
    const crossing = { ...command, eventIds: [selected[0]!.id, track.measures[32]!.numberedVoice.events[0]!.id] };
    expect(previewNumberedTupletEdit(track, crossing)).toMatchObject({ ok: false, message: expect.stringContaining("同一小节") });

    // 两个普通八分音原本恰好填到短小节末尾，按 2:3 延长后才溢出。
    measure.numberedVoice.events = selected.slice(0, 2).map((event, index) => ({
      ...event, tick: measure.actualDurationTicks! - (2 - index) * 480,
    }));
    measure.lyrics = measure.lyrics.filter(({ eventId }) => command.eventIds.includes(eventId));
    expect(previewNumberedTupletEdit(track, command)).toEqual(overlap);
  });
});
