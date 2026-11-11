import { describe, expect, it } from "vitest";
import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import { buildLayout, hitTestLayout } from "../../src/layout";
import {
  collectMusicTextMeasureRequests,
  musicTextRequest,
} from "../../src/layout/music-text/music-text-metrics";
import { LXM_FRET_TEXT_FONT_SIZE } from "../../src/layout/layout-constants";
import { getFretTextBounds } from "../../src/layout/techniques/technique-geometry";
import { loadDocument } from "../../src/core/document/loader";

/** 复用规范文档的调弦和小节结构，只替换正文为等时值单音。 */
const regularScore = (
  base: "quarter" | "eighth" | "thirtySecond",
  dual: boolean,
) => {
  const document = structuredClone(EXAMPLE_MVP_2);
  const track = document.score.tracks[0]!;
  const template = track.measures[0]!;
  const count = { quarter: 4, eighth: 8, thirtySecond: 32 }[base];
  track.techniques = [];
  track.numberedMarks = [];
  track.measures = Array.from({ length: 12 }, (_, measureIndex) => {
    const id = `regular-${measureIndex}`;
    const beats = Array.from({ length: count }, (_, i) => ({
      ...template.beats[0]!,
      id: `${id}-beat-${i}`,
      tick: i * 3840 / count,
      rhythm: { base, dots: 0 },
      notes: [{
        id: `${id}-note-${i}`,
        string: i % 6 + 1,
        fret: base === "thirtySecond" ? 12 : i % 8,
      }],
    }));
    return {
      ...template,
      id,
      barline: "single" as const,
      chordSymbols: [],
      lyrics: [],
      tuplets: [],
      beats,
      numberedVoice: {
        events: dual ? beats.map((beat, i) => ({
          id: `${id}-event-${i}`,
          kind: "notes" as const,
          tick: beat.tick,
          rhythm: beat.rhythm,
          items: [{ id: `${id}-item-${i}`, token: String(i % 7 + 1) }],
        })) : [],
        tuplets: [],
      },
    };
  });
  return document;
};

const options = { systemWidth: 733.228, density: "compact" as const };

describe("REQ-001 紧凑正文", () => {
  it.each(["quarter", "eighth"] as const)(
    "普通 %s 纯 TAB 和双谱的非末行自然容纳 4–6 小节",
    (base) => {
      for (const dual of [false, true]) {
        const document = regularScore(base, dual);
        expect(loadDocument(JSON.stringify(document)).ok).toBe(true);
        for (const purpose of ["editing", "presentation"] as const) {
          const layout = buildLayout(document, { ...options, purpose });
          expect(layout.systems.length).toBeGreaterThan(1);
          for (const system of layout.systems.slice(0, -1)) {
            expect(system.measures.length).toBeGreaterThanOrEqual(4);
            expect(system.measures.length).toBeLessThanOrEqual(6);
            expect(system.width).toBeCloseTo(options.systemWidth);
          }
          expect(layout.systems.flatMap((s) => s.measures)).toHaveLength(12);
          for (const measure of layout.systems.flatMap((s) => s.measures)) {
            measure.beats.forEach((beat, i) => {
              if (i) expect(beat.x).toBeGreaterThan(measure.beats[i - 1]!.x);
              if (dual)
                expect(measure.numberedNotation![i]!.labels[0]!.x).toBe(beat.x);
            });
          }
        }
      }
    },
  );

  it("六弦间距 20/3，近中心均命中所属弦，TAB 字母与拍号使用紧凑字号和基线", () => {
    const layout = buildLayout(regularScore("quarter", false), options);
    const system = layout.systems[0]!;
    const measure = system.measures[0]!;
    const top = measure.strings[0]!.y1;
    measure.strings.forEach((string, i) => {
      expect(string.y1 - top).toBeCloseTo(i * 20 / 3);
    });
    expect(system.header.tabLetters.map((t) => t.y - top)).toEqual([6, 18, 30]);
    expect(system.header.tabLetters.every((t) => t.fontSize === 9)).toBe(true);
    expect(measure.timeSignature!.numerator.y - top).toBe(12);
    expect(measure.timeSignature!.denominator.y - top).toBe(27);
    expect(measure.timeSignature!.numerator.fontSize).toBe(12);
    expect(measure.timeSignature!.denominator.fontSize).toBe(12);
    for (const string of measure.strings) {
      for (const offset of [-(10 / 3 - 0.1), 0, 10 / 3 - 0.1]) {
        expect(hitTestLayout(layout, {
          x: measure.beats[0]!.x,
          y: string.y1 + offset,
        })).toMatchObject({ string: string.index, beatId: measure.beats[0]!.id });
      }
    }
  });

  it("相邻弦中点稳定归属靠前弦，中点两侧分别命中相邻弦", () => {
    const layout = buildLayout(regularScore("quarter", false), options);
    const measure = layout.systems[0]!.measures[0]!;
    for (let i = 0; i < measure.strings.length - 1; i++) {
      const midpoint = (measure.strings[i]!.y1 + measure.strings[i + 1]!.y1) / 2;
      for (const [offset, string] of [[-0.1, i + 1], [0, i + 1], [0.1, i + 2]] as const) {
        expect(hitTestLayout(layout, {
          x: measure.beats[0]!.x,
          y: midpoint + offset,
        })).toMatchObject({ string, beatId: measure.beats[0]!.id });
      }
    }
  });

  it("品位为 8、简谱为 11，简谱度量请求与实际绘制共用缓存键", () => {
    expect(LXM_FRET_TEXT_FONT_SIZE).toBe(8);
    const document = regularScore("eighth", true);
    const requests = collectMusicTextMeasureRequests(document);
    const request = musicTextRequest("1", 11);
    expect(requests).toContainEqual(request);
    const metrics = { [request.key]: { x: -3, y: -8, width: 6, height: 10 } };
    for (const purpose of ["editing", "presentation"] as const) {
      const layout = buildLayout(document, { ...options, purpose, musicTextMetrics: metrics });
      const measure = layout.systems[0]!.measures[0]!;
      const labels = measure.numberedNotation!.flatMap((n) => n.labels);
      expect(labels.every((label) => label.fontSize === 11)).toBe(true);
      expect(labels[0]).toMatchObject({ key: request.key, measured: true });
      const note = measure.notes[0]!;
      const bounds = getFretTextBounds(note);
      // Arial 8 数字实测墨迹 ascent/descent，加两侧各 .4 的白色描边。
      expect(bounds.height).toBeCloseTo(5.75 + 0.1015625 + 0.8);
      expect(bounds.y).toBeCloseTo(note.y + 2.5 - 5.75 - 0.4);
      expect(bounds.y + bounds.height).toBeCloseTo(note.y + 2.5 + 0.1015625 + 0.4);
    }
  });

  it("连续双位三十二分音符允许少于四小节，完整字形不重叠、不超出实际小节", () => {
    for (const dual of [false, true]) {
      const layout = buildLayout(regularScore("thirtySecond", dual), options);
      expect(layout.systems[0]!.measures.length).toBeLessThan(4);
      for (const measure of layout.systems.flatMap((s) => s.measures)) {
        const bounds = measure.notes.map(getFretTextBounds);
        bounds.forEach((b, i) => {
          expect(b.x).toBeGreaterThanOrEqual(measure.x);
          expect(b.x + b.width).toBeLessThanOrEqual(measure.x + measure.width);
          if (i) expect(b.x - bounds[i - 1]!.x - bounds[i - 1]!.width).toBeGreaterThanOrEqual(4 - 1e-8);
        });
        expect(measure.width).toBeGreaterThan(500);
      }
    }
  });

  it("长歌词仍按 11 字号和实际净空撑开双谱，允许少于四小节", () => {
    const document = regularScore("eighth", true);
    for (const measure of document.score.tracks[0]!.measures) {
      measure.lyrics = measure.numberedVoice.events.map((event, i) => ({
        id: `${measure.id}-lyric-${i}`,
        eventId: event.id,
        verse: 1,
        text: "歌词保持清晰",
      }));
    }
    for (const purpose of ["editing", "presentation"] as const) {
      const layout = buildLayout(document, { ...options, purpose });
      expect(layout.systems[0]!.measures.length).toBeLessThan(4);
      for (const measure of layout.systems.flatMap((s) => s.measures)) {
        const lyrics = measure.lyrics!;
        lyrics.forEach((lyric, i) => {
          expect(lyric.label.fontSize).toBe(11);
          if (i) expect(lyric.bounds.x).toBeGreaterThanOrEqual(
            lyrics[i - 1]!.bounds.x + lyrics[i - 1]!.bounds.width,
          );
        });
      }
    }
  });
});
