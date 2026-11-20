import { describe, expect, it } from "vitest";
import { applyScoreCommand, buildLayout, EXAMPLE_MVP_7_2_DOCUMENT, hitTestNumbered } from "../../src";
import { musicTextInkBounds, musicTextRequest } from "../../src/layout/music-text/music-text-metrics";

const glyphClearance = (left: Parameters<typeof musicTextInkBounds>[0], right: typeof left) => {
  const ink = musicTextInkBounds(left);
  return musicTextInkBounds(right).x - (ink.x + ink.width);
};

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[5]!;
  const result = applyScoreCommand(document, {
    type: "numbered.range.replace", trackId: track.id, measureId: measure.id,
    startTick: 1920, endTick: 2880, allowOverwrite: true,
    items: ["3", "3", "4", "5"].map(token => ({ kind: "set" as const, tokens: [token] })),
    rhythms: Array.from({ length: 4 }, () => ({ base: "sixteenth" as const, dots: 0 })),
  });
  if (!result.ok) throw new Error(result.message);
  return { document: result.document, measureId: measure.id };
};

describe("BUG-030 简谱短音符横向间距", () => {
  it.each(["editing", "presentation"] as const)("%s 中四个十六分保留时间对齐、字形净空和逐音命中", purpose => {
    const { document, measureId } = fixture();
    const before = structuredClone(document);
    for (const systemWidth of [840, 1040]) {
      const layout = buildLayout(document, { purpose, density: "compact", systemWidth });
      const measure = layout.systems.flatMap(system => system.measures).find(item => item.id === measureId)!;
      const events = document.score.tracks[0]!.measures[5]!.numberedVoice.events.filter(event => event.tick >= 1920 && event.tick < 2880);
      expect(events.map(event => event.tick)).toEqual([1920, 2160, 2400, 2640]);
      const notes = events.map(event => measure.numberedNotation!.find(note => note.eventId === event.id)!);
      for (const [index, note] of notes.entries()) {
        const label = note.labels.find(item => item.fontFamily !== "Bravura")!;
        const anchor = measure.timeAnchors.find(item => item.tick === events[index]!.tick)!;
        expect(label.x).toBeCloseTo(anchor.x);
        const tab = measure.beats.find(beat => beat.tick === events[index]!.tick);
        if (tab) expect(label.x).toBeCloseTo(tab.x);
        if (index > 0) {
          const previous = notes[index - 1]!.labels.find(item => item.fontFamily !== "Bravura")!;
          expect(glyphClearance(previous, label)).toBeGreaterThanOrEqual(2);
        }
        expect(hitTestNumbered(layout, {
          x: label.bounds.x + label.bounds.width / 2,
          y: label.bounds.y + label.bounds.height / 2,
        })).toMatchObject({ eventId: events[index]!.id });
      }
    }
    expect(document).toEqual(before);
  });

  it.each(["editing", "presentation"] as const)("%s 中已度量数字的四个十六分首尾跨度不超过57.6", purpose => {
    const { document, measureId } = fixture();
    // 模拟客户端已度量的 11px 数字；上面的无 DOM 用例保留保守大字形保护。
    const metrics = Object.fromEntries(Array.from({ length: 8 }, (_, digit) => [
      musicTextRequest(String(digit), 11).key,
      { x: -3.06, y: -10, width: 6.12, height: 12 },
    ]));
    for (const systemWidth of [840, 1040]) {
      const layout = buildLayout(document, { purpose, density: "compact", systemWidth, musicTextMetrics: metrics });
      const measure = layout.systems.flatMap(system => system.measures).find(item => item.id === measureId)!;
      const events = document.score.tracks[0]!.measures[5]!.numberedVoice.events.filter(event => event.tick >= 1920 && event.tick < 2880);
      const labels = events.map(event => measure.numberedNotation!.find(note => note.eventId === event.id)!.labels[0]!);
      expect(labels[3]!.x - labels[0]!.x).toBeLessThanOrEqual(57.6 + 1e-6);
      for (let index = 1; index < labels.length; index++) {
        expect(labels[index]!.x - labels[index - 1]!.x).toBeLessThanOrEqual(19.2 + 1e-6);
        expect(glyphClearance(labels[index - 1]!, labels[index]!)).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
