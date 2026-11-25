import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  applyScoreCommand,
  createDocumentIdFactory,
  createNumberedRhythmContext,
  editNumberedTrack,
  loadDocument,
  previewNumberedTupletEdit,
  type ILXMDocument,
  type ILXMNumberedTupletCommand,
  type ILXMScoreCommand,
} from "../../src";

const example = readFileSync(new URL("../../example/ideal-score.lxm.json", import.meta.url), "utf8");
const eighth = { base: "eighth", dots: 0 } as const;
const sixteenth = { base: "sixteenth", dots: 0 } as const;
const lastBeat = 960;

const getMeasure = (document: ILXMDocument) => document.score.tracks[0]!.measures[34]!;

const load = (source: string) => {
  const result = loadDocument(source);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.document;
};

const fixture = (twoEighths = false) => {
  const document = load(example);
  const track = document.score.tracks[0]!;
  const measure = getMeasure(document);
  const { events, tuplets } = measure.numberedVoice;
  // 示例谱已录好第 35 小节的两组三连音。将末拍还原成待转换的节奏，保留首拍与第 36 小节原谱。
  const rhythms = twoEighths ? [eighth, eighth] : [eighth, sixteenth, sixteenth];
  const positions = [lastBeat, lastBeat + 480, lastBeat + 720];
  const selected = rhythms.map((rhythm, index) => ({ ...events[index + 3]!, rhythm, tick: positions[index]! }));
  measure.numberedVoice = { events: [...events.slice(0, 3), ...selected], tuplets: tuplets.slice(0, 1) };
  measure.lyrics = measure.lyrics.filter((lyric) => measure.numberedVoice.events.some((event) => event.id === lyric.eventId));
  const command = {
    type: "numbered.tuplet.createInBeat",
    trackId: track.id,
    measureId: measure.id,
    startTick: lastBeat,
  } satisfies ILXMNumberedTupletCommand;
  return { document, track, measure, selected, command };
};

const execute = (document: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(result.message);
  return result.document;
};

describe("BUG-080 简谱本拍三连音", () => {
  it("末拍前八后十六一次转换为等长三连音，保留原音、歌词和跨小节端点", () => {
    const { document, track, measure, selected, command } = fixture();
    const nextMeasure = track.measures[35]!;
    const marked = execute(document, {
      type: "numbered.mark.add",
      trackId: track.id,
      mark: {
        type: "tie",
        fromItemId: selected[2]!.items[0]!.id,
        toItemId: nextMeasure.numberedVoice.events[0]!.items[0]!.id,
      },
    });
    expect(previewNumberedTupletEdit(marked.score.tracks[0]!, command)).toEqual({ ok: true });
    const converted = execute(marked, command);
    expect(converted.documentRevision).toBe(marked.documentRevision + 1);
    const { numberedVoice, ...otherMeasureContent } = getMeasure(converted);
    const { numberedVoice: beforeVoice, ...beforeMeasureContent } = measure;
    const members = numberedVoice.events.slice(3);
    expect(members).toEqual(selected.map((event, index) => ({ ...event, rhythm: eighth, tick: lastBeat + index * 320 })));
    const context = createNumberedRhythmContext(numberedVoice);
    expect(members.map(context.getEventDurationTicks)).toEqual(Array(3).fill({ ok: true, ticks: 320 }));
    expect(numberedVoice.events.slice(0, 3)).toEqual(beforeVoice.events.slice(0, 3));
    expect(numberedVoice.tuplets).toEqual([
      beforeVoice.tuplets[0],
      { id: expect.any(String), eventIds: selected.map((event) => event.id), ratio: { actual: 3, normal: 2 } },
    ]);
    expect(otherMeasureContent).toEqual(beforeMeasureContent);
    expect(converted.score.tracks[0]!.numberedMarks).toEqual(marked.score.tracks[0]!.numberedMarks);
    expect(converted.score.tracks[0]!.measures[35]).toEqual(nextMeasure);
    expect(getMeasure(load(JSON.stringify(converted))).numberedVoice).toEqual(numberedVoice);
    expect(getMeasure(marked).numberedVoice.events.slice(3)).toEqual(selected);
  });

  it("两音转换保留原音并留下可续填的第三槽，填满后不能越过小节展开", () => {
    const { document, measure, selected, command } = fixture(true);
    const converted = load(JSON.stringify(execute(document, command)));
    const { events, tuplets } = getMeasure(converted).numberedVoice;
    const gap = events[5]!;
    const group = tuplets[1]!;
    expect(events.slice(3, 5)).toEqual(selected.map((event, index) => ({ ...event, tick: lastBeat + index * 320 })));
    expect(gap).toEqual({ id: expect.any(String), tick: lastBeat + 640, rhythm: eighth, kind: "gap", items: [] });
    expect(group.eventIds).toEqual([...selected.map((event) => event.id), gap.id]);
    expect(getMeasure(converted).lyrics).toEqual(measure.lyrics);

    const remove = { ...command, type: "numbered.tuplet.remove", tupletId: group.id } as const;
    expect(getMeasure(execute(converted, remove)).numberedVoice).toEqual(measure.numberedVoice);
    const filled = execute(converted, {
      type: "numbered.sequence.set",
      trackId: command.trackId,
      measureId: command.measureId,
      eventId: gap.id,
      items: [{ kind: "set", tokens: ["5"] }],
      allowOverwrite: false,
    });
    expect(getMeasure(filled).numberedVoice.events[5]).toMatchObject({ id: gap.id, kind: "notes", items: [{ token: "5" }] });
    const blocked = previewNumberedTupletEdit(filled.score.tracks[0]!, remove);
    expect(blocked).toMatchObject({ ok: false, code: "NUMBERED_OVERLAP", message: expect.stringContaining("本拍空间不足，无法展开成三个普通八分音符") });
    expect(applyScoreCommand(filled, remove)).toEqual(blocked);
  });

  it("只接受支持的完整四分拍，拒绝越界、切断事件及重复归组", () => {
    const { document, track, measure, selected, command } = fixture();
    for (const numerator of [2, 3, 4]) {
      measure.timeSignature = { numerator, denominator: 4 };
      expect(previewNumberedTupletEdit(track, command)).toEqual({ ok: true });
    }
    for (const startTick of [lastBeat - 1, lastBeat + 960]) {
      expect(previewNumberedTupletEdit(track, { ...command, startTick })).toMatchObject({ ok: false });
    }
    measure.timeSignature = { numerator: 6, denominator: 8 };
    expect(previewNumberedTupletEdit(track, command)).toMatchObject({ ok: false, message: expect.stringContaining("当前拍号") });
    measure.timeSignature = { numerator: 4, denominator: 4 };
    expect(previewNumberedTupletEdit(track, { ...command, startTick: 0 })).toMatchObject({ ok: false, message: expect.stringContaining("再次归组") });

    // 跨拍长音在小节内合法，但末拍窗口不能截断它。
    measure.numberedVoice = {
      events: [{ ...selected[0]!, tick: lastBeat - 240, rhythm: eighth }],
      tuplets: [],
    };
    measure.lyrics = [];
    expect(applyScoreCommand(document, command)).toMatchObject({ ok: false, code: "NUMBERED_PARTIAL_RANGE" });
  });

  it("预览与失败提交均不分配 ID，失效的组尾延音线拦截整笔转换", () => {
    const { document, track, selected, command } = fixture(true);
    const factory = createDocumentIdFactory(document);
    const createEventId = vi.spyOn(factory, "createNumberedEventId");
    const createGroupId = vi.spyOn(factory, "createNumberedTupletId");
    expect(editNumberedTrack(track, command, factory, true).ok).toBe(true);

    const from = selected[1]!.items[0]!;
    const to = track.measures[35]!.numberedVoice.events[0]!.items[0]!;
    from.token = to.token;
    const marked = execute(document, {
      type: "numbered.mark.add",
      trackId: track.id,
      mark: { type: "tie", fromItemId: from.id, toItemId: to.id },
    });
    const blocked = previewNumberedTupletEdit(marked.score.tracks[0]!, command);
    expect(blocked).toMatchObject({ ok: false, message: expect.stringContaining("延音线") });
    expect(editNumberedTrack(marked.score.tracks[0]!, command, factory)).toEqual(blocked);
    expect(applyScoreCommand(marked, command)).toEqual(blocked);
    expect(createEventId).not.toHaveBeenCalled();
    expect(createGroupId).not.toHaveBeenCalled();
  });
});
