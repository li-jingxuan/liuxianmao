import { describe, expect, it } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  type ILXMNumberedEvent,
} from "../../src";
import {
  musicTextInkBounds,
  musicTextRequest,
} from "../../src/layout/music-text/music-text-metrics";
import { summarizeMeasureSpacingWidth, layoutMeasureSpacing } from "../../src/layout/structure/measure-spacing";
import { layoutNumbered } from "../../src/layout/music-text/numbered-notation-layout";
import { layoutNumberedRhythm } from "../../src/layout/music-text/numbered-rhythm-layout";

const event = (
  tick: number,
  base: ILXMNumberedEvent["rhythm"]["base"] = "sixteenth",
  token = "3",
  dots = 0,
): ILXMNumberedEvent => ({
  id: `e${tick}`,
  tick,
  kind: token === "0" ? "rest" : "notes",
  rhythm: { base, dots },
  items: [{ id: `i${tick}`, token }],
});

const fixture = (events: ILXMNumberedEvent[]) => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  track.measures = [measure];
  track.techniques = [];
  track.numberedMarks = [];
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.beats = [0, 960, 1920, 2880].map(tick => ({
    id: `b${tick}`, tick, kind: "rest", notes: [],
    rhythm: { base: "quarter", dots: 0 },
  }));
  measure.tuplets = [];
  measure.lyrics = [];
  measure.chordSymbols = [];
  measure.numberedVoice = { events, tuplets: [] };
  return { document, measure };
};

const metricsFor = (width: number) => Object.fromEntries(
  Array.from({ length: 8 }, (_, digit) => [
    musicTextRequest(String(digit), 11).key,
    { x: -width / 2, y: -10, width, height: 12 },
  ]),
);

describe.each(["editing", "presentation"] as const)("BUG035/037/040 %s 减时线", purpose => {
  const geometry = (document: ReturnType<typeof fixture>["document"], systemWidth = 200, width = 6.12) =>
    buildLayout(document, { purpose, density: "compact", systemWidth, musicTextMetrics: metricsFor(width) })
      .systems[0]!.measures[0]!;

  it("四个八分 0 每拍共享一条线，端点只向数字墨迹外伸 1px", () => {
    const { document } = fixture([0, 480, 960, 1440].map(tick => event(tick, "eighth", "0")));
    const frames = geometry(document).numberedNotation!;
    expect(frames.map(frame => frame.lines!.length)).toEqual([1, 0, 1, 0]);
    for (const start of [0, 2]) {
      const line = frames[start]!.lines![0]!;
      const first = musicTextInkBounds(frames[start]!.labels[0]!);
      const last = musicTextInkBounds(frames[start + 1]!.labels[0]!);
      expect(line.shared).toBe(true);
      expect(line.x1).toBeCloseTo(first.x - 1);
      expect(line.x2).toBeCloseTo(last.x + last.width + 1);
    }
  });

  it("八分 0 + 十六分 3/2 的首层跨越全部成员，第二层仅连接 3/2", () => {
    const { document } = fixture([event(0, "eighth", "0"), event(480), event(720, "sixteenth", "2")]);
    const frames = geometry(document).numberedNotation!;
    expect(frames.map(frame => frame.lines!.length)).toEqual([1, 1, 0]);
    const first = frames[0]!.lines![0]!;
    const second = frames[1]!.lines![0]!;
    expect(first.shared && second.shared).toBe(true);
    expect(second.y - first.y).toBeCloseTo(3);
    expect(first.x1).toBeLessThan(second.x1);
    expect(first.x2).toBeCloseTo(second.x2);
  });

  it("notes/rest 混排逐层连接三十二分，较低层级不吞掉独立短线", () => {
    const { document } = fixture([
      event(0, "eighth", "0"), event(480),
      event(720, "thirtySecond", "0"), event(840, "thirtySecond"),
      event(960, "eighth"), event(1440, "sixteenth", "0"),
    ]);
    const frames = geometry(document).numberedNotation!;
    expect(frames.map(frame => frame.lines!.length)).toEqual([1, 1, 1, 0, 1, 1]);
    expect(frames.slice(0, 3).every(frame => frame.lines![0]!.shared)).toBe(true);
    expect(new Set(frames.slice(0, 3).map(frame => frame.lines![0]!.y)).size).toBe(3);
    const isolated = frames[5]!.lines![0]!;
    expect(isolated.shared).not.toBe(true);
    expect(isolated.x2 - isolated.x1).toBeCloseTo(8.12);
  });

  it("附点休止按实际时值连续；下一拍断开且附点仍有净空", () => {
    const { document } = fixture([
      event(0, "eighth", "0", 1), event(720), event(960), event(1200, "sixteenth", "0"),
    ]);
    const frames = geometry(document).numberedNotation!;
    expect(frames[0]!.lines![0]!.shared).toBe(true);
    expect(frames[0]!.lines![0]!.x2).toBeCloseTo(frames[1]!.lines![0]!.x2);
    expect(frames[0]!.rhythmDots).toHaveLength(1);
    const dot = frames[0]!.rhythmDots![0]!;
    const next = musicTextInkBounds(frames[1]!.labels[0]!);
    expect(next.x - dot.cx - dot.r).toBeGreaterThanOrEqual(2.5 - 1e-6);
    expect(frames[2]!.lines![0]!.x1 - frames[0]!.lines![0]!.x2).toBeGreaterThanOrEqual(3 - 1e-6);
  });

  it("连音组内的休止参与连线，相邻连音组与组外音符保持独立", () => {
    const { document, measure } = fixture([
      event(0, "eighth"), event(320, "eighth", "0"), event(640, "eighth"),
      event(960, "eighth", "0"), event(1280, "eighth"), event(1600, "eighth", "0"),
      event(1920, "eighth"),
    ]);
    measure.numberedVoice.tuplets = [0, 960].map(tick => ({
      id: `tuplet${tick}`, ratio: { actual: 3, normal: 2 },
      eventIds: [tick, tick + 320, tick + 640].map(t => `e${t}`),
    }));
    const frames = geometry(document).numberedNotation!;
    expect(frames.map(frame => frame.lines!.length)).toEqual([1, 0, 0, 1, 0, 0, 1]);
    expect(frames[0]!.lines![0]!.shared).toBe(true);
    expect(frames[3]!.lines![0]!.shared).toBe(true);
    expect(frames[6]!.lines![0]!.shared).not.toBe(true);
    for (const [a, b] of [[0, 3], [3, 6]])
      expect(frames[b!]!.lines![0]!.x1 - frames[a!]!.lines![0]!.x2).toBeGreaterThanOrEqual(3 - 1e-6);
  });

  it("6/8 继续按两个附点四分拍组连接混排的八分 0/音符", () => {
    const { document, measure } = fixture(Array.from({ length: 6 }, (_, i) =>
      event(i * 480, "eighth", i % 2 === 0 ? "0" : "3")));
    measure.timeSignature = { numerator: 6, denominator: 8 };
    measure.beats = measure.beats.slice(0, 3);
    const frames = geometry(document).numberedNotation!;
    expect(frames.map(frame => frame.lines!.length)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(frames[0]!.lines![0]!.shared && frames[3]!.lines![0]!.shared).toBe(true);
    expect(frames[3]!.lines![0]!.x1 - frames[0]!.lines![0]!.x2).toBeGreaterThanOrEqual(3 - 1e-6);
  });

  it.each([6.12, 14])("窄行至宽行的每拍十六分各层至少留 3px 净空（墨迹宽 %s）", width => {
    const { document } = fixture(Array.from({ length: 16 }, (_, i) =>
      event(i * 240, "sixteenth", i % 2 === 0 ? "0" : "3")));
    for (const systemWidth of [120, 200, 420, 840]) {
      const frames = geometry(document, systemWidth, width).numberedNotation!;
      expect(frames.flatMap(frame => frame.lines!)).toHaveLength(8);
      for (const tick of [960, 1920, 2880]) {
        const previous = frames.find(frame => frame.eventId === `e${tick - 960}`)!;
        const next = frames.find(frame => frame.eventId === `e${tick}`)!;
        for (let layer = 0; layer < 2; layer++) {
          expect(previous.lines![layer]!.shared && next.lines![layer]!.shared).toBe(true);
          expect(next.lines![layer]!.x1 - previous.lines![layer]!.x2).toBeGreaterThanOrEqual(3 - 1e-6);
        }
      }
    }
  });

  it("完全压缩到硬宽度时仍满足拍组净空", () => {
    const { document, measure } = fixture(Array.from({ length: 16 }, (_, i) => event(i * 240)));
    const metrics = metricsFor(14);
    const summary = summarizeMeasureSpacingWidth(measure, "compact", 0, metrics, true, undefined, { purpose });
    const spacing = layoutMeasureSpacing(measure, {
      x: 0, density: "compact", assignedWidth: summary.minWidth, spacingSummary: summary,
    });
    const layout = geometry(document, 120, 14);
    const frames = layoutNumberedRhythm(measure, {
      ...layout,
      timeAnchors: Object.entries(spacing.xByTick).map(([tick, x]) => ({ tick: Number(tick), x })),
      numberedSlots: Object.values(spacing.slotsByNumberedEventId),
    }, measure.numberedVoice.events.map(e => layoutNumbered(e.id, e.items.map(item => item.token), spacing.xByTick[e.tick]!, 0, metrics)));
    for (const tick of [960, 1920, 2880]) {
      const previous = frames.find(frame => frame.eventId === `e${tick - 960}`)!;
      const next = frames.find(frame => frame.eventId === `e${tick}`)!;
      expect(next.lines![0]!.x1 - previous.lines![0]!.x2).toBeCloseTo(3);
    }
  });
});
