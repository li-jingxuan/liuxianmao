import { describe, expect, it } from "vitest";
import { planNumberedEventRhythm } from "../../src/core/numbered-timeline";
import { editNumberedTrack } from "../../src/core/numbered-commands";
import { createDocumentIdFactory } from "../../src/core/id-factory";
import { applyScoreCommand } from "../../src/core/commands";
import { calculateRhythmTicks } from "../../src/core/rhythm";
import { validateNumberedVoice } from "../../src/core/numbered-rhythm";
import example from "../../example/example-mvp7.2";
import type {
  ILXMMeasure,
  ILXMNumberedEvent,
  ILXMRhythm,
} from "../../src/core/types";

const rhythm = (base: ILXMRhythm["base"], dots = 0): ILXMRhythm => ({
  base,
  dots,
});
const note = (
  id: string,
  tick: number,
  base: ILXMRhythm["base"] = "quarter",
): ILXMNumberedEvent => ({
  id,
  tick,
  rhythm: rhythm(base),
  kind: "notes",
  items: [{ id: `${id}-item`, token: "1" }],
});
const measure = (events: ILXMNumberedEvent[]): ILXMMeasure => ({
  ...structuredClone(example.score.tracks[0]!.measures[0]!),
  id: "measure",
  timeSignature: { numerator: 4, denominator: 4 },
  lyrics: [],
  numberedVoice: { events, tuplets: [] },
});
const plan = (m: ILXMMeasure, r: ILXMRhythm) => {
  const result = planNumberedEventRhythm(m, "a", r);
  if (!result.ok) throw new Error(result.message);
  return result;
};

describe("简谱独立时间轴", () => {
  it("缩短释放原位空白，保留事件与后续位置", () => {
    const m = measure([
      note("a", 0),
      note("b", 960),
      note("c", 1920),
      note("d", 2880),
    ]);
    const original = structuredClone(m);
    const result = plan(m, rhythm("eighth"));
    expect(result.releasedRange).toEqual({ startTick: 480, endTick: 960 });
    expect(result.voice.events.map((e) => e.tick)).toEqual([
      0, 960, 1920, 2880,
    ]);
    expect(result.voice.events[0]!.items).toEqual(
      m.numberedVoice.events[0]!.items,
    );
    expect(result.movedEventIds).toEqual([]);
    expect(m).toEqual(original);
  });
  it("延长先消费紧邻空白，不移动后续音符", () => {
    const result = plan(
      measure([note("a", 0, "eighth"), note("b", 960), note("c", 2880)]),
      rhythm("quarter"),
    );
    expect(result.voice.events.map((e) => e.tick)).toEqual([0, 960, 2880]);
    expect(result.resizedEventIds).toEqual(["a"]);
    expect(result.movedEventIds).toEqual([]);
  });
  it("空白不足时只移动剩余增长量，保留后续内部空白", () => {
    const result = plan(
      measure([
        note("a", 0, "eighth"),
        note("b", 720, "eighth"),
        note("c", 1680, "eighth"),
      ]),
      rhythm("quarter"),
    );
    expect(result.voice.events.map((e) => e.tick)).toEqual([0, 960, 1920]);
    expect(result.resizedEventIds).toEqual(["a"]);
  });
  it("满小节精确压缩后续音符，保留全部身份及歌词", () => {
    const m = measure([
      note("a", 0, "eighth"),
      note("b", 480, "eighth"),
      note("c", 960),
      note("d", 1920),
      note("e", 2880),
    ]);
    m.lyrics = [{ id: "lyric", eventId: "c", verse: 1, text: "词" }];
    const result = plan(m, rhythm("quarter"));
    expect(result.voice.events.map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(result.voice.events.map((e) => e.tick)).toEqual([
      0, 960, 1440, 1920, 2880,
    ]);
    expect(result.resizedEventIds).toEqual(["a", "c"]);
    expect(m.lyrics[0]!.eventId).toBe("c");
  });
  it("完整后续连音组按实际时长平移，不压缩成员", () => {
    const m = measure([
      note("a", 0, "eighth"),
      note("b", 480, "eighth"),
      note("c", 800, "eighth"),
      note("d", 1120, "eighth"),
    ]);
    m.numberedVoice.tuplets = [
      {
        id: "group",
        ratio: { actual: 3, normal: 2 },
        eventIds: ["b", "c", "d"],
      },
    ];
    const result = plan(m, rhythm("quarter"));
    expect(result.voice.events.map((e) => e.tick)).toEqual([
      0, 960, 1280, 1600,
    ]);
    expect(result.resizedEventIds).toEqual(["a"]);
    expect(planNumberedEventRhythm(m, "b", rhythm("quarter"))).toMatchObject({
      ok: false,
      code: "EVENT_IN_TUPLET",
    });
  });
  it("尾部容量不足且无法精确压缩时拒绝，不修改原数据", () => {
    const m = measure([
      note("a", 3360, "eighth"),
      note("b", 3840 - 120, "thirtySecond"),
    ]);
    const original = structuredClone(m);
    expect(planNumberedEventRhythm(m, "a", rhythm("quarter"))).toMatchObject({
      ok: false,
      code: "CANNOT_COMPRESS",
    });
    expect(m).toEqual(original);
  });
  it("支持附点和不同拍号，不越过小节", () => {
    const m = measure([note("a", 0, "eighth"), note("b", 480, "eighth")]);
    m.timeSignature = { numerator: 3, denominator: 8 };
    const result = plan(m, rhythm("eighth", 1));
    expect(result.voice.events[1]!.tick).toBe(720);
    expect(planNumberedEventRhythm(m, "a", rhythm("whole"))).toMatchObject({
      ok: false,
    });
  });
  it("空白可部分填入并返回剩余窗口，不生成延音线或复制歌词", () => {
    const document = structuredClone(example);
    const track = {
      ...document.score.tracks[0]!,
      numberedMarks: [],
      measures: [measure([note("a", 0, "eighth"), note("b", 960)])],
    };
    const result = editNumberedTrack(
      track,
      {
        type: "numbered.sequence.insert",
        trackId: track.id,
        measureId: "measure",
        startTick: 480,
        endTick: 960,
        items: [{ kind: "set", tokens: ["2"] }],
        rhythms: [rhythm("sixteenth")],
      },
      createDocumentIdFactory(document),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.track.measures[0]!.numberedVoice.events.map((e) => e.tick),
    ).toEqual([0, 480, 960]);
    expect(result.nextFocus).toEqual({ tick: 720, endTick: 960 });
    expect(result.track.numberedMarks).toEqual([]);
    expect(result.track.measures[0]!.lyrics).toEqual([]);
  });
  it("连续填入遇已有内容整次拒绝，不覆盖", () => {
    const document = structuredClone(example);
    const track = {
      ...document.score.tracks[0]!,
      numberedMarks: [],
      measures: [measure([note("a", 0, "eighth"), note("b", 960)])],
    };
    const original = structuredClone(track);
    expect(
      editNumberedTrack(
        track,
        {
          type: "numbered.sequence.insert",
          trackId: track.id,
          measureId: "measure",
          startTick: 480,
          endTick: 1920,
          items: [
            { kind: "set", tokens: ["2"] },
            { kind: "set", tokens: ["3"] },
          ],
          rhythms: [rhythm("eighth"), rhythm("eighth")],
        },
        createDocumentIdFactory(document),
      ),
    ).toMatchObject({ ok: false, code: "NUMBERED_OVERLAP" });
    expect(track).toEqual(original);
  });
  it("真实文档缩短再填空只改简谱，原歌词保留，新音默认无词", () => {
    const document = structuredClone(example);
    document.score.tracks = [
      {
        ...document.score.tracks[0]!,
        techniques: [],
        numberedMarks: [],
        measures: [
          measure([
            note("a", 0),
            note("b", 960),
            note("c", 1920),
            note("d", 2880),
          ]),
        ],
      },
    ];
    const track = document.score.tracks[0]!;
    track.measures[0]!.lyrics = [
      { id: "lyric", eventId: "a", verse: 1, text: "风" },
    ];
    const originalTab = structuredClone(track.measures[0]!.beats);
    const shortened = applyScoreCommand(document, {
      type: "numbered.event.setRhythm",
      trackId: track.id,
      measureId: "measure",
      eventId: "a",
      rhythm: rhythm("eighth"),
      timeline: "editTimeline",
    });
    expect(shortened.ok, JSON.stringify(shortened)).toBe(true);
    if (!shortened.ok) return;
    const filled = applyScoreCommand(shortened.document, {
      type: "numbered.sequence.insert",
      trackId: track.id,
      measureId: "measure",
      startTick: 480,
      endTick: 960,
      items: [{ kind: "set", tokens: ["2"] }],
      rhythms: [rhythm("eighth")],
    });
    expect(filled.ok, JSON.stringify(filled)).toBe(true);
    if (!filled.ok) return;
    const after = filled.document.score.tracks[0]!.measures[0]!;
    expect(after.numberedVoice.events.map((e) => e.tick)).toEqual([
      0, 480, 960, 1920, 2880,
    ]);
    expect(after.beats).toEqual(originalTab);
    expect(after.lyrics).toEqual(track.measures[0]!.lyrics);
    expect(filled.document.documentRevision).toBe(
      document.documentRevision + 2,
    );
    expect(
      document.score.tracks[0]!.measures[0]!.numberedVoice.events,
    ).toHaveLength(4);
  });
  it("组合回归：不同附点、空白和后续音符都保持身份及合法时间轴", () => {
    const candidates = [
      rhythm("half"),
      rhythm("quarter"),
      rhythm("quarter", 1),
      rhythm("eighth"),
      rhythm("eighth", 1),
      rhythm("sixteenth"),
      rhythm("thirtySecond"),
    ];
    let successes = 0;
    let failures = 0;
    for (const before of candidates)
      for (const after of [...candidates, rhythm("whole")])
        for (const gap of [0, 120, 480]) {
          const duration = calculateRhythmTicks(before);
          if (!duration.ok) throw new Error("invalid fixture");
          const first = { ...note("a", 0), rhythm: before };
          const tail = [
            note("b", duration.ticks + gap, "eighth"),
            note("c", duration.ticks + gap + 960, "eighth"),
          ];
          const m = measure([first, ...tail]);
          const original = structuredClone(m);
          const result = planNumberedEventRhythm(m, "a", after);
          expect(m).toEqual(original);
          if (!result.ok) {
            failures++;
            continue;
          }
          successes++;
          expect(validateNumberedVoice(result.voice, 3840)).toBeNull();
          expect(result.voice.events.map((e) => e.id)).toEqual(["a", "b", "c"]);
          expect(result.voice.events.map((e) => e.items)).toEqual(
            m.numberedVoice.events.map((e) => e.items),
          );
        }
    expect(successes).toBeGreaterThan(100);
    expect(failures).toBeGreaterThan(0);
  });
});
