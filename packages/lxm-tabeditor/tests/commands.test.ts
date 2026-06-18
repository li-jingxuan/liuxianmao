import { describe, expect, it } from "vitest";
import {
  reduceScoreCommand,
  reduceScoreTransaction,
} from "../src/commands/score-command-reducer";
import type { Measure } from "../src/core/schema";
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
      id: "measure-005",
      beats: [0, 960, 1920].map((tick, index) => ({
        id: `beat-005-0${index + 1}`,
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
        measureId: "measure-005",
        definition: { id: "chord-d", name: "D", frets: [2, 3, 2, 0, "x", "x"] },
        symbol: {
          id: "chord-symbol-007",
          tick: 0,
          chordDefinitionId: "chord-d",
          display: "nameOnly",
        },
      },
    });
    expect(chordResult.ok).toBe(true);
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
