import { describe, expect, it } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  applyScoreCommand,
  planNumberedInputRanges,
  hitTestNumbered,
  layoutParagraphFocus,
  collectMusicTextMeasureRequests,
  type ILXMMusicTextMetrics,
} from "../../src";

/** 真实联合布局只改变升降号，排除八度、节奏和歌词造成的合法行高变化。 */
const scoreWithToken = (token: string) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.numberedMarks = [];
  track.measures = [track.measures[0]!];
  const measure = track.measures[0]!;
  measure.chordSymbols = [];
  measure.lyrics = [];
  measure.numberedVoice.events = [
    {
      id: "numbered-event",
      kind: "notes",
      tick: 0,
      rhythm: { base: "eighth", dots: 0 },
      items: [{ id: "numbered-item", token }],
    },
  ];
  measure.numberedVoice.tuplets = [];
  return document;
};

describe("简谱行高与拍号回归", () => {
  it.each(["#4", "b7", "n4"])(
    "%s 使用实际墨迹度量后完整符号也不撑高行",
    (token) => {
      const score = scoreWithToken(token);
      const metrics: ILXMMusicTextMetrics = Object.fromEntries(
        collectMusicTextMeasureRequests(score).map((r) => [
          r.key,
          r.fontFamily === "Bravura"
            ? { x: -2, y: -8, width: 4, height: 18 }
            : { x: -4, y: -12, width: 8, height: 15.5 },
        ]),
      );
      const plain = buildLayout(scoreWithToken(token.slice(1)), {
        musicTextMetrics: metrics,
      }).systems[0]!;
      const altered = buildLayout(score, { musicTextMetrics: metrics })
        .systems[0]!;
      const n = altered.measures[0]!.numberedNotation![0]!,
        digit = n.labels.find((g) => g.fontFamily !== "Bravura")!,
        accidental = n.labels.find((g) => g.fontFamily === "Bravura")!;
      expect(altered.height).toBeCloseTo(plain.height);
      expect(accidental.bounds.y).toBeGreaterThanOrEqual(
        digit.bounds.y - 0.001,
      );
      expect(
        accidental.bounds.y + accidental.bounds.height,
      ).toBeLessThanOrEqual(digit.bounds.y + digit.bounds.height + 0.001);
      expect(
        hitTestNumbered(buildLayout(score, { musicTextMetrics: metrics }), {
          x: accidental.x,
          y: accidental.bounds.y + accidental.bounds.height / 2,
        }),
      ).toMatchObject({ itemId: "numbered-item" });
    },
  );
  it.each(["#4", "b7", "n4"])("%s 不额外撑高简谱行或下移减时线", (token) => {
    const plain = buildLayout(scoreWithToken(token.slice(1))).systems[0]!;
    const accidental = buildLayout(scoreWithToken(token)).systems[0]!;
    expect(accidental.height).toBeCloseTo(plain.height);
    expect(accidental.numberedRow!.height).toBeCloseTo(
      plain.numberedRow!.height,
    );
    expect(
      accidental.measures[0]!.numberedNotation![0]!.lines![0]!.y,
    ).toBeCloseTo(plain.measures[0]!.numberedNotation![0]!.lines![0]!.y);
  });
  it("简谱结构保留小节线，但不绘制拍号；TAB 保留公共拍号", () => {
    const layout = buildLayout(scoreWithToken("4"));
    expect(
      layout.systems[0]!.numberedMarks!.some((m) =>
        m.markId.endsWith("numbered-meter"),
      ),
    ).toBe(false);
    expect(
      layout.systems[0]!.numberedMarks!.some((m) =>
        m.markId.includes("numbered-barline"),
      ),
    ).toBe(true);
    expect(layout.systems[0]!.measures[0]!.timeSignature).toBeDefined();
  });
  it("四分缩成八分后只生成一个后方半拍空位，命中和焦点使用同一时间窗", () => {
    const score = scoreWithToken("1"),
      m = score.score.tracks[0]!.measures[0]!;
    m.numberedVoice.events[0]!.rhythm = { base: "quarter", dots: 0 };
    m.numberedVoice.events.push({
      id: "next-event",
      kind: "notes",
      tick: 960,
      rhythm: { base: "half", dots: 1 },
      items: [{ id: "next-item", token: "2" }],
    });
    const result = applyScoreCommand(score, {
      type: "numbered.event.setRhythm",
      trackId: score.score.tracks[0]!.id,
      measureId: m.id,
      eventId: "numbered-event",
      rhythm: { base: "eighth", dots: 0 },
    });
    if (!result.ok) throw Error(result.message);
    const layout = buildLayout(result.document, { purpose: "editing" }),
      slot = layout.systems[0]!.measures[0]!.numberedInputSlots![0]!;
    expect(layout.systems[0]!.measures[0]!.numberedInputSlots).toHaveLength(1);
    expect(slot).toMatchObject({
      startTick: 480,
      endTick: 960,
      rhythm: { base: "eighth", dots: 0 },
      target: { kind: "numberedTime", tick: 480, endTick: 960 },
    });
    expect(
      hitTestNumbered(layout, { x: slot.anchorX, y: slot.y + slot.height / 2 }),
    ).toEqual(slot.target);
    expect(
      layoutParagraphFocus(layout, { ...slot.target, kind: "numbered" }),
    ).toMatchObject({ y: slot.y, height: slot.height });
    expect(slot.y).toBeCloseTo(
      layout.systems[0]!.measures[0]!.numberedNotation![0]!.labels[0]!.bounds.y,
    );
  });
  it("长音内部没有占位，Tuplet gap 的窗口指向原成员而非 TAB", () => {
    const m = scoreWithToken("1").score.tracks[0]!.measures[0]!;
    m.numberedVoice.events[0]!.rhythm = { base: "whole", dots: 0 };
    expect(planNumberedInputRanges(m)).toEqual([]);
    m.numberedVoice.events = [0, 320, 640].map((tick, i) =>
      i === 1
        ? {
            id: `e${i}`,
            kind: "gap",
            tick,
            rhythm: { base: "eighth", dots: 0 },
            items: [],
          }
        : {
            id: `e${i}`,
            kind: "notes",
            tick,
            rhythm: { base: "eighth", dots: 0 },
            items: [{ id: `i${i}`, token: "1" }],
          },
    );
    m.numberedVoice.tuplets = [
      {
        id: "group",
        ratio: { actual: 3, normal: 2 },
        eventIds: ["e0", "e1", "e2"],
      },
    ];
    expect(planNumberedInputRanges(m)[0]).toEqual({
      eventId: "e1",
      startTick: 320,
      endTick: 640,
      rhythm: { base: "eighth", dots: 0 },
    });
  });
  it("时值扩展切断后续长音或覆盖 Tuplet 时原子拒绝", () => {
    const score = scoreWithToken("1"),
      track = score.score.tracks[0]!,
      m = track.measures[0]!;
    m.numberedVoice.events[0]!.rhythm = { base: "sixteenth", dots: 0 };
    m.numberedVoice.events.push({
      id: "next",
      kind: "notes",
      tick: 240,
      rhythm: { base: "quarter", dots: 0 },
      items: [{ id: "next-item", token: "2" }],
    });
    const snapshot = JSON.stringify(score),
      command = {
        type: "numbered.event.setRhythm" as const,
        trackId: track.id,
        measureId: m.id,
        eventId: "numbered-event",
        rhythm: { base: "quarter" as const, dots: 0 },
      };
    expect(applyScoreCommand(score, command)).toMatchObject({
      ok: false,
      code: "NUMBERED_PARTIAL_RANGE",
    });
    expect(JSON.stringify(score)).toBe(snapshot);
    m.numberedVoice.events[0]!.rhythm = { base: "quarter", dots: 0 };
    m.numberedVoice.events.splice(
      1,
      1,
      ...[960, 1280, 1600].map((tick, i) => ({
        id: `t${i}`,
        kind: "notes" as const,
        tick,
        rhythm: { base: "eighth" as const, dots: 0 },
        items: [{ id: `ti${i}`, token: "2" }],
      })),
    );
    m.numberedVoice.tuplets = [
      {
        id: "g",
        ratio: { actual: 3, normal: 2 },
        eventIds: ["t0", "t1", "t2"],
      },
    ];
    expect(
      applyScoreCommand(score, {
        ...command,
        rhythm: { base: "half", dots: 0 },
      }),
    ).toMatchObject({ ok: false, code: "NUMBERED_PARTIAL_RANGE" });
  });
});
