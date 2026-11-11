import { describe, expect, it } from "vitest";
import DEFAULT_SCORE from "../../example/default-score.lxm.json";
import { buildLayout } from "../../src/layout";
import { loadDocument } from "../../src/core/document/loader";
import { layoutMeasureSpacing, summarizeMeasureSpacingWidth } from "../../src/layout/structure/measure-spacing";
import { buildTechniqueInsets, fretHalfWidth } from "../../src/layout/techniques/technique-spacing";
import type { ILXMMeasure } from "../../src/core/types";
import { createChordBlock } from "../../src/layout/music-text/music-text-layout";
import { musicTextGlyph, musicTextRequest, MUSIC_LYRIC_FONT_SIZE } from "../../src/layout/music-text/music-text-metrics";
import { layoutNumbered } from "../../src/layout/music-text/numbered-notation-layout";
import { numberedLayoutProfile } from "../../src/layout/music-text/numbered-layout-profile";
import { layoutMeasure } from "../../src/layout/structure/measure-layout";
import { layoutNumberedRhythm } from "../../src/layout/music-text/numbered-rhythm-layout";

const document = () => {
  const loaded = loadDocument(JSON.stringify(DEFAULT_SCORE));
  if (!loaded.ok) throw new Error("Default score must load");
  return loaded.document;
};

/** Independently check visible ink/technique and source spans against final anchors. */
const verifyHardClearance = (
  measure: ILXMMeasure,
  spacing: ReturnType<typeof layoutMeasureSpacing>,
  insets: ReturnType<typeof buildTechniqueInsets>,
  purpose: "editing" | "presentation",
) => {
  const profile = numberedLayoutProfile(purpose, "compact");
  const lanes = new Map<string, { tick: number; left: number; right: number }[]>();
  const add = (lane: string, tick: number, left: number, right: number) =>
    lanes.set(lane, [...(lanes.get(lane) ?? []), { tick, left, right }]);
  for (const beat of measure.beats) {
    const half = Math.max(0, ...beat.notes.map((n) => fretHalfWidth(n.fret)));
    const inset = insets.get(beat.id);
    add("tab", beat.tick, Math.max(half, inset?.left ?? 0), Math.max(half, inset?.right ?? 0));
    expect(spacing.slotsByBeatId[beat.id]!.width).toBeGreaterThanOrEqual(9 - 1e-8);
  }
  for (const event of measure.numberedVoice.events) {
    if (event.kind === "gap") continue;
    const bounds = layoutNumbered(event.id, event.items.map((i) => i.token), 0, 0, undefined, profile).bounds;
    add("numbered", event.tick, -bounds.x - 2, bounds.x + bounds.width - 2 + event.rhythm.dots * 4);
    expect(spacing.slotsByNumberedEventId[event.id]!.width).toBeGreaterThanOrEqual(10 - 1e-8);
  }
  for (const lyric of measure.lyrics) {
    const event = measure.numberedVoice.events.find((e) => e.id === lyric.eventId)!;
    const bounds = musicTextGlyph(musicTextRequest(lyric.text, MUSIC_LYRIC_FONT_SIZE), 0, 0).bounds;
    add(`lyric-${lyric.verse}`, event.tick, -bounds.x, bounds.x + bounds.width);
  }
  for (const chord of measure.chordSymbols) {
    const beat = measure.beats.find((b) => b.id === chord.beatId)!;
    const bounds = createChordBlock(chord).bounds;
    add("chord", beat.tick, -bounds.x, bounds.x + bounds.width);
  }
  let spansMultipleColumns = false;
  for (const [lane, extents] of lanes) {
    extents.sort((a, b) => a.tick - b.tick);
    extents.forEach((extent, i) => {
      const x = spacing.xByTick[extent.tick]!;
      expect(x - extent.left).toBeGreaterThanOrEqual(6 - 1e-8);
      expect(x + extent.right).toBeLessThanOrEqual(spacing.assignedWidth - 6 + 1e-8);
      const previous = extents[i - 1];
      if (!previous || extent.tick === previous.tick) return;
      const gap = lane === "tab" ? 2 : lane === "numbered" ? profile.glyphGap : 6;
      expect(x - extent.left - spacing.xByTick[previous.tick]! - previous.right).toBeGreaterThanOrEqual(gap - 1e-8);
      if (spacing.columns.filter((c) => c.tick >= previous.tick && c.tick < extent.tick).length > 1)
        spansMultipleColumns = true;
    });
  }
  return spansMultipleColumns;
};

describe("compact default mock: five original measures", () => {
  it.each(["editing", "presentation"] as const)("%s fits five within A4 and retains every measure", (purpose) => {
    const score = document();
    const measures = score.score.tracks[0]!.measures;
    const before = structuredClone(score);
    const layout = buildLayout(score, { density: "compact", purpose, systemWidth: 733.228 });
    expect(layout.systems.map((system) => system.measures.length)).toEqual([5, 3]);
    expect(layout.systems[0]!.measures.map((m) => m.id)).toEqual(measures.slice(0, 5).map((m) => m.id));
    expect(layout.systems[0]!.width).toBeCloseTo(733.228, 6);
    expect(layout.systems.flatMap((s) => s.measures.map((m) => m.id))).toEqual(measures.map((m) => m.id));
    expect(layout.systems.every((s) => s.measures.length <= 5)).toBe(true);
    expect(score).toEqual(before);
    for (const system of layout.systems) {
      const chords = system.measures.flatMap((m) => m.chordSymbols ?? []);
      chords.forEach((chord, i) => {
        const previous = chords[i - 1];
        if (previous) expect(chord.bounds.x - previous.bounds.x - previous.bounds.width).toBeGreaterThanOrEqual(4 - 1e-8);
      });
    }
  });

  it.each(["editing", "presentation"] as const)("%s interpolates entire feasible DAGs, including multi-column hard edges", (purpose) => {
    const score = document();
    const track = score.score.tracks[0]!;
    const insets = buildTechniqueInsets(track);
    let multiColumn = false;
    let compressed = false;
    for (const measure of track.measures) {
      const summary = summarizeMeasureSpacingWidth(measure, "compact", 0, undefined, true, insets, { purpose });
      const at = (ratio: number) => layoutMeasureSpacing(measure, {
        x: 0, density: "compact", spacingSummary: summary,
        assignedWidth: summary.minWidth + (summary.idealWidth - summary.minWidth) * ratio,
      });
      const hard = at(0), ideal = at(1);
      compressed ||= summary.idealWidth > summary.minWidth;
      for (const ratio of [0, 0.17, 0.5, 0.83, 1]) {
        const actual = at(ratio);
        for (const [tick, x] of Object.entries(actual.xByTick))
          expect(x).toBeCloseTo(hard.xByTick[Number(tick)]! +
            (ideal.xByTick[Number(tick)]! - hard.xByTick[Number(tick)]!) * ratio, 8);
        multiColumn = verifyHardClearance(measure, actual, insets, purpose) || multiColumn;
      }
      expect(() => layoutMeasureSpacing(measure, {
        x: 0, density: "compact", spacingSummary: summary, assignedWidth: summary.minWidth - 0.1,
      })).toThrow(RangeError);
    }
    expect(compressed).toBe(true);
    expect(multiColumn).toBe(true);
  });

  it("long lyrics, double frets, chords and actual techniques retain hard clearance and may wrap before five", () => {
    const score = document();
    const track = score.score.tracks[0]!;
    for (const measure of track.measures) {
      for (const beat of measure.beats)
        for (const note of beat.notes) note.fret = 12;
      for (const lyric of measure.lyrics) lyric.text = "长歌词保持实际净空";
      for (const chord of measure.chordSymbols) chord.chord.name = "Gmaj13(add9)/F#";
    }
    const insets = buildTechniqueInsets(track);
    for (const purpose of ["editing", "presentation"] as const) {
      const layout = buildLayout(score, { density: "compact", purpose, systemWidth: 733.228 });
      expect(layout.systems[0]!.measures.length).toBeLessThan(5);
      expect(layout.systems.flatMap((s) => s.measures.map((m) => m.id))).toEqual(track.measures.map((m) => m.id));
      for (const measure of track.measures) {
        const summary = summarizeMeasureSpacingWidth(measure, "compact", 0, undefined, true, insets, { purpose });
        for (const ratio of [0, 0.37, 1])
          verifyHardClearance(measure, layoutMeasureSpacing(measure, {
            x: 0, density: "compact", spacingSummary: summary,
            assignedWidth: summary.minWidth + (summary.idealWidth - summary.minWidth) * ratio,
          }), insets, purpose);
      }
    }
  });

  it("hidden numbered input reservations leave pure TAB geometry identical across purposes", () => {
    const score = document();
    for (const measure of score.score.tracks[0]!.measures) {
      measure.numberedVoice = { events: [], tuplets: [] };
      measure.lyrics = [];
    }
    score.score.tracks[0]!.numberedMarks = [];
    const options = { density: "compact" as const, systemWidth: 733.228 };
    const presentation = buildLayout(score, { ...options, purpose: "presentation" });
    expect(buildLayout(score, { ...options, purpose: "editing" }).systems).toEqual(presentation.systems);
    expect(buildLayout(score, options).systems).toEqual(presentation.systems);
  });

  it.each(["half", "whole"] as const)("compressed pure TAB %s notes retain drawable sustain units", (base) => {
    const score = document();
    const track = score.score.tracks[0]!;
    track.techniques = [];
    track.numberedMarks = [];
    const template = track.measures[0]!;
    const count = base === "whole" ? 1 : 2;
    track.measures = Array.from({ length: 12 }, (_, i) => ({
      ...structuredClone(template), id: `long-${i}`, lyrics: [], chordSymbols: [], tuplets: [],
      numberedVoice: { events: [], tuplets: [] },
      beats: Array.from({ length: count }, (_, j) => ({
        ...structuredClone(template.beats[0]!), id: `long-${i}-${j}`, tick: j * 3840 / count,
        rhythm: { base, dots: 0 },
        notes: [{ id: `long-note-${i}-${j}`, string: 3, fret: 12 }],
      })),
    }));
    const layout = buildLayout(score, { density: "compact", systemWidth: 160, purpose: "presentation" });
    expect(layout.systems.flatMap((s) => s.measures)).toHaveLength(12);
    for (const system of layout.systems) {
      for (const measure of system.measures) {
        for (const beat of measure.beats) expect(beat.width / (4 / count)).toBeGreaterThanOrEqual(8 - 1e-8);
        for (const mark of measure.durationMarks) {
          for (const sustain of mark.sustainMarks) {
            expect(sustain.x2 - sustain.x1).toBeGreaterThanOrEqual(4 - 1e-8);
            expect(sustain.x2).toBeLessThanOrEqual(measure.x + measure.width + 1e-8);
          }
        }
      }
    }
  });

  it.each(["editing", "presentation"] as const)("%s protects rendered numbered rhythm dots at hard, intermediate and ideal widths", (purpose) => {
    const measure = structuredClone(document().score.tracks[0]!.measures[0]!);
    measure.beats = [];
    measure.tuplets = [];
    measure.chordSymbols = [];
    measure.lyrics = [];
    measure.numberedVoice = {
      tuplets: [], events: [
        { tick: 0, base: "eighth" as const, dots: 1 },
        { tick: 720, base: "sixteenth" as const, dots: 0 },
        { tick: 960, base: "half" as const, dots: 0 },
        { tick: 2880, base: "quarter" as const, dots: 0 },
      ].map(({ tick, base, dots }, i) => ({
        id: `dotted-${i}`, tick, kind: "notes" as const, rhythm: { base, dots },
        items: [{ id: `dotted-item-${i}`, token: "1" }],
      })),
    };
    const summary = summarizeMeasureSpacingWidth(measure, "compact", 0, undefined, true, undefined, { purpose });
    for (const ratio of [0, 0.5, 1]) {
      const laidOut = layoutMeasure(measure, {
        index: 0, systemIndex: 0, x: 0, y: 0, density: "compact", spacingSummary: summary,
        assignedWidth: summary.minWidth + (summary.idealWidth - summary.minWidth) * ratio,
      });
      const frames = layoutNumberedRhythm(measure, laidOut, measure.numberedVoice.events.map((e) =>
        layoutNumbered(e.id, ["1"], laidOut.numberedSlots.find((s) => s.id === e.id)!.x, 0, undefined,
          numberedLayoutProfile(purpose, "compact"))));
      expect(frames[0]!.rhythmDots).toHaveLength(1);
      const dot = frames[0]!.rhythmDots![0]!;
      const next = frames[1]!.labels[0]!;
      // labels include 2px measurement protection; assert against actual digit ink.
      expect(next.bounds.x + 2 - dot.cx - dot.r).toBeGreaterThanOrEqual(
        numberedLayoutProfile(purpose, "compact").glyphGap - 1e-8);
    }
  });
});
