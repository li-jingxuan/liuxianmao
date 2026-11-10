import { describe, expect, it } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  hitTestNumbered,
  musicTextRequest,
  type ILXMNumberedEvent,
} from "../../src";
import { musicTextInkBounds } from "../../src/layout/music-text-metrics";
import { numberedLayoutProfile } from "../../src/layout/numbered-layout-profile";
import { getMeasureContentBottom } from "../../src/layout/rhythm-bounds";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];
  track.techniques = [];
  track.numberedMarks = [];
  const measure = track.measures[0]!;
  measure.lyrics = [];
  measure.chordSymbols = [];
  measure.numberedVoice = {
    tuplets: [],
    events: [
      { tick: 0, base: "eighth", dots: 0, token: "5''" },
      { tick: 480, base: "eighth", dots: 0, token: "6" },
      { tick: 960, base: "sixteenth", dots: 1, token: "6.." },
      { tick: 1920, base: "thirtySecond", dots: 0, token: "1" },
    ].map(({ tick, base, dots, token }, i) => ({
      id: `refinement-${i}`,
      tick,
      kind: "notes",
      rhythm: { base, dots },
      items: [{ id: `refinement-item-${i}`, token }],
    })) as ILXMNumberedEvent[],
  };
  return document;
};

describe("BUG009–014 谱面几何契约", () => {
  it.each(["editing", "presentation"] as const)(
    "%s 完整简谱含高音点与上方连线，距 TAB 节奏保留规定净空",
    (purpose) => {
      const document = fixture();
      document.score.tracks[0]!.numberedMarks = [{
        id: "upper-slur",
        type: "slur",
        fromEventId: "refinement-0",
        toEventId: "refinement-1",
      }];
      const before = structuredClone(document);
      const layout = buildLayout(document, { purpose });
      const system = layout.systems[0]!;
      const numberedTop = Math.min(
        ...system.measures.flatMap((m) => m.numberedNotation!.map((n) => n.bounds.y)),
        ...system.numberedMarks!.map((m) => m.bounds.y),
      );
      const tabBottom = Math.max(...system.measures.map(getMeasureContentBottom));
      expect(numberedTop - tabBottom).toBeCloseTo(purpose === "editing" ? 8 : 7.5);
      expect(document).toEqual(before);
    },
  );

  for (const measured of [false, true]) {
    it.each(["editing", "presentation"] as const)(
      `%s ${measured ? "实测" : "fallback"}数字墨迹距减时线 2，线层间距及低音点命中保持独立`,
      (purpose) => {
        const document = fixture();
        const musicTextMetrics = measured ? Object.fromEntries(
          ["1", "5", "6"].map((text) => [musicTextRequest(text, 11).key,
            { x: -4, y: -14, width: 8, height: 18 }]),
        ) : undefined;
        const layout = buildLayout(document, { purpose, musicTextMetrics });
        const frames = layout.systems[0]!.measures[0]!.numberedNotation!;
        const inkBottom = Math.max(...frames.flatMap((frame) => frame.labels.map((label) => {
          expect(label.measured).toBe(measured);
          const ink = musicTextInkBounds(label);
          return ink.y + ink.height;
        })));
        const lines = frames.flatMap((frame) => frame.lines!);
        expect(lines.some((line) => line.shared)).toBe(true);
        expect(lines.every((line) => line.thickness === 1.1)).toBe(true);
        const levels = [...new Set(lines.map((line) => line.y))].sort((a, b) => a - b);
        expect(levels).toHaveLength(3);
        expect(levels[0]! - 1.1 / 2 - inkBottom).toBeCloseTo(2);
        expect(levels[1]! - levels[0]!).toBeCloseTo(3);
        expect(levels[2]! - levels[1]!).toBeCloseTo(3);

        for (const frame of frames) {
          for (const dot of frame.dots) expect(dot.r).toBe(0.8);
        }
        const high = frames[0]!.dots;
        const low = frames[2]!.dots;
        const profile = numberedLayoutProfile(purpose);
        expect(high[0]!.cy - high[1]!.cy).toBeCloseTo(1.6 + profile.octaveStackGap);
        expect(low[1]!.cy - low[0]!.cy).toBeCloseTo(1.6 + profile.octaveStackGap);
        const ownLineBottom = Math.max(...frames[2]!.lines!.map((line) => line.y + line.thickness / 2));
        expect(low[0]!.cy - low[0]!.r - ownLineBottom).toBeCloseTo(profile.octaveGap);
        expect(frames[2]!.rhythmDots).toHaveLength(1);
        expect(frames[2]!.rhythmDots![0]!.r).toBe(1.3);
        for (const dot of low) {
          expect(hitTestNumbered(layout, { x: dot.cx, y: dot.cy })).toMatchObject({
            eventId: "refinement-2", itemId: "refinement-item-2",
          });
        }
      },
    );
  }
});
