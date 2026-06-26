import { describe, expect, it } from "vitest";
import {
  reduceScoreCommand,
  reduceScoreTransaction,
} from "../src/commands/score-command-reducer";
import type { AddNotePayload } from "../src/commands/command-types";
import type { Measure } from "../src/core/schema";
import { createEmptyMeasure, createEmptyScore } from "../src/core/score-factory";
import { createExampleDocument } from "../src/testing/example-document";

const TARGET = {
  trackId: "track-guitar-001",
  measureId: "measure-001",
  beatId: "beat-001-05",
} as const;

describe("Score Command reducer", () => {
  it("更新品位时不修改原 score", () => {
    const original = createExampleDocument().score;
    const snapshot = structuredClone(original);
    const result = reduceScoreCommand(original, {
      type: "note.updateFret",
      payload: { ...TARGET, noteId: "note-001-05-01", fret: 7 },
    });
    expect(result.ok).toBe(true);
    expect(original).toEqual(snapshot);
    if (result.ok) expect(result.value).not.toBe(original);
  });

  it("支持新增、删除音符和应用技巧", () => {
    const score = createExampleDocument().score;
    const deleted = reduceScoreCommand(score, {
      type: "note.delete",
      payload: { ...TARGET, noteId: "note-001-05-01" },
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    const added = reduceScoreCommand(deleted.value, {
      type: "note.add",
      payload: {
        ...TARGET,
        note: { id: "note-new", string: 2, fret: 5, techniques: [] },
      },
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const technique = reduceScoreCommand(added.value, {
      type: "technique.apply",
      payload: {
        ...TARGET,
        noteId: "note-new",
        technique: { type: "vibrato", width: "small" },
      },
    });
    expect(technique.ok).toBe(true);
  });

  it("支持插入合法小节和原子 upsert 和弦", () => {
    const score = createExampleDocument().score;
    const measure: Measure = {
      id: "measure-009",
      beats: [0, 960, 1920].map((tick, index) => ({
        id: `beat-009-0${index + 1}`,
        tick,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest" as const,
      })),
      tuplets: [],
      chordSymbols: [],
      lyrics: [],
      barline: "final",
    };
    const inserted = reduceScoreCommand(score, {
      type: "measure.add",
      payload: {
        trackId: "track-guitar-001",
        afterMeasureId: "measure-004",
        measure,
      },
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const chordResult = reduceScoreCommand(inserted.value, {
      type: "chord.upsert",
      payload: {
        trackId: "track-guitar-001",
        measureId: "measure-009",
        definition: { id: "chord-d", name: "D", frets: [2, 3, 2, 0, "x", "x"] },
        symbol: {
          id: "chord-symbol-011",
          tick: 0,
          chordDefinitionId: "chord-d",
          display: "nameOnly",
        },
      },
    });
    expect(chordResult.ok).toBe(true);
  });

  it("支持修改时值、设置休止符和从休止符恢复音符", () => {
    const score = createExampleDocument().score;
    const setRest = reduceScoreCommand(score, {
      type: "beat.setRest",
      payload: TARGET,
    });
    expect(setRest.ok).toBe(true);
    if (!setRest.ok) return;
    const clearRest = reduceScoreCommand(setRest.value, {
      type: "beat.clearRest",
      payload: {
        ...TARGET,
        note: { id: "note-rest-restored", string: 2, fret: 3, techniques: [] },
      },
    });
    expect(clearRest.ok).toBe(true);
    if (!clearRest.ok) return;
    const rhythm = reduceScoreCommand(clearRest.value, {
      type: "beat.setRhythm",
      payload: { ...TARGET, rhythm: { base: "quarter", dots: 0 } },
    });
    expect(rhythm.ok).toBe(true);
  });

  it("支持在长 rest 内部按当前时值写入音符", () => {
    const score = createEmptyScore();
    const result = reduceScoreCommand(score, {
      type: "note.add",
      payload: {
        trackId: "track-guitar-main",
        measureId: "measure-001",
        beatId: "beat-001-1",
        tick: 120,
        rhythm: { base: "thirtySecond", dots: 0 },
        note: { id: "note-slot", string: 2, fret: 3, techniques: [] },
      } as AddNotePayload & {
        tick: number;
        rhythm: { base: "thirtySecond"; dots: 0 };
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.tracks[0]!.measures[0]!.beats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "beat-001-1__rest_before_0",
          tick: 0,
          kind: "rest",
          rhythm: { base: "thirtySecond", dots: 0 },
        }),
        expect.objectContaining({
          id: "beat-001-1",
          tick: 120,
          kind: "notes",
          rhythm: { base: "thirtySecond", dots: 0 },
        }),
        expect.objectContaining({
          tick: 240,
          kind: "rest",
        }),
      ]),
    );
  });

  it("支持在 gap slot 内按当前时值写入音符", () => {
    const score = createEmptyScore();
    score.tracks[0]!.measures[0] = {
      ...score.tracks[0]!.measures[0]!,
      beats: [
        {
          id: "beat-gap-existing",
          tick: 0,
          rhythm: { base: "quarter", dots: 0 },
          kind: "rest",
        },
      ],
    };

    const result = reduceScoreCommand(score, {
      type: "note.add",
      payload: {
        trackId: "track-guitar-main",
        measureId: "measure-001",
        tick: 960,
        slotKind: "gap",
        gapStartTick: 960,
        gapEndTick: 3840,
        rhythm: { base: "quarter", dots: 0 },
        note: { id: "note-gap-write", string: 2, fret: 5, techniques: [] },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.tracks[0]!.measures[0]!.beats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tick: 960, kind: "notes" }),
        expect.objectContaining({
          tick: 1920,
          kind: "rest",
          rhythm: { base: "half", dots: 0 },
        }),
      ]),
    );
  });

  it("支持在 gap slot 内按当前时值写入休止符", () => {
    const score = createEmptyScore();
    score.tracks[0]!.measures[0] = {
      ...score.tracks[0]!.measures[0]!,
      beats: [
        {
          id: "beat-gap-existing",
          tick: 0,
          rhythm: { base: "quarter", dots: 0 },
          kind: "rest",
        },
      ],
    };

    const result = reduceScoreCommand(score, {
      type: "beat.setRest",
      payload: {
        trackId: "track-guitar-main",
        measureId: "measure-001",
        tick: 960,
        slotKind: "gap",
        gapStartTick: 960,
        gapEndTick: 3840,
        rhythm: { base: "quarter", dots: 0 },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.tracks[0]!.measures[0]!.beats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tick: 960, kind: "rest" }),
        expect.objectContaining({
          tick: 1920,
          kind: "rest",
          rhythm: { base: "half", dots: 0 },
        }),
      ]),
    );
  });

  it("gap 写入后 beats 仍按 tick 升序排列", () => {
    const score = createEmptyScore();
    score.tracks[0]!.measures[0] = {
      ...score.tracks[0]!.measures[0]!,
      beats: [
        {
          id: "beat-gap-existing",
          tick: 0,
          rhythm: { base: "quarter", dots: 0 },
          kind: "rest",
        },
      ],
    };

    const result = reduceScoreCommand(score, {
      type: "note.add",
      payload: {
        trackId: "track-guitar-main",
        measureId: "measure-001",
        tick: 2880,
        slotKind: "gap",
        gapStartTick: 960,
        gapEndTick: 3840,
        rhythm: { base: "quarter", dots: 0 },
        note: { id: "note-gap-late", string: 1, fret: 7, techniques: [] },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ticks = result.value.tracks[0]!.measures[0]!.beats.map(
      (beat) => beat.tick,
    );
    expect(ticks).toEqual([...ticks].sort((left, right) => left - right));
  });

  it("支持删除、复制小节和最后小节 fallback", () => {
    const score = createExampleDocument().score;
    const duplicate = reduceScoreCommand(score, {
      type: "measure.duplicate",
      payload: {
        trackId: "track-guitar-001",
        measureId: "measure-004",
        measure: createEmptyMeasure({
          id: "measure-004-copy",
          beatIdPrefix: "beat-004-copy",
          timeSignature: { numerator: 3, denominator: 4 },
          barline: "final",
        }),
      },
    });
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(duplicate.value.tracks[0]!.measures).toHaveLength(9);

    const deleted = reduceScoreCommand(duplicate.value, {
      type: "measure.delete",
      payload: { trackId: "track-guitar-001", measureId: "measure-004-copy" },
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.value.tracks[0]!.measures).toHaveLength(8);

    const singleMeasureScore = {
      ...score,
      tracks: [
        { ...score.tracks[0]!, measures: [score.tracks[0]!.measures[0]!] },
      ],
    };
    const deleteLast = reduceScoreCommand(singleMeasureScore, {
      type: "measure.delete",
      payload: {
        trackId: "track-guitar-001",
        measureId: "measure-001",
        fallbackMeasure: createEmptyMeasure({
          id: "measure-fallback",
          beatIdPrefix: "beat-fallback",
          timeSignature: { numerator: 4, denominator: 4 },
          includeTimeSignature: true,
          barline: "final",
        }),
      },
    });
    expect(deleteLast.ok).toBe(true);
    if (deleteLast.ok) {
      expect(deleteLast.value.tracks[0]!.measures[0]!.id).toBe(
        "measure-fallback",
      );
    }
  });

  it("支持创建和解除连音组", () => {
    const score = createExampleDocument().score;
    const setTuplet = reduceScoreCommand(score, {
      type: "tuplet.set",
      payload: {
        trackId: "track-guitar-001",
        measureId: "measure-003",
        tuplet: {
          id: "tuplet-003-01",
          actualNotes: 3,
          normalNotes: 3,
          beatIds: ["beat-003-01", "beat-003-02", "beat-003-03"],
          bracket: "show",
        },
      },
    });
    expect(setTuplet.ok).toBe(true);
    if (!setTuplet.ok) return;
    const clearTuplet = reduceScoreCommand(setTuplet.value, {
      type: "tuplet.clear",
      payload: {
        trackId: "track-guitar-001",
        measureId: "measure-003",
        tupletId: "tuplet-003-01",
      },
    });
    expect(clearTuplet.ok).toBe(true);
    if (clearTuplet.ok) {
      expect(clearTuplet.value.tracks[0]!.measures[2]!.tuplets).toHaveLength(0);
    }
  });

  it("事务任一步失败时整体回滚", () => {
    const score = createExampleDocument().score;
    const result = reduceScoreTransaction(score, [
      {
        type: "note.updateFret",
        payload: { ...TARGET, noteId: "note-001-05-01", fret: 7 },
      },
      {
        type: "note.add",
        payload: {
          ...TARGET,
          note: { id: "note-conflict", string: 2, fret: 9, techniques: [] },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(score).toEqual(createExampleDocument().score);
  });
});
