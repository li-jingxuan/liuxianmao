import { describe, expect, it } from "vitest";

import { changeMeasureTimeSignature } from "../../src/core/time-signature-change";
import type { ILXMBeat, ILXMMeasure } from "../../src/core/types";

const createIdFactory = () => {
  let nextId = 1;
  return () => `new-rest-${nextId++}`;
};

const createBeat = (
  id: string,
  tick: number,
  base: ILXMBeat["rhythm"]["base"],
  kind: ILXMBeat["kind"],
): ILXMBeat => ({
  id,
  tick,
  rhythm: { base, dots: 0 },
  kind,
  notes: kind === "notes" ? [{ id: `${id}-note`, string: 3, fret: 5 }] : [],
});

const createMeasure = (beats: ILXMBeat[]): ILXMMeasure => ({
  id: "time-signature-measure",
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "double",
  chordSymbols: [],
  beats,
});

describe("changeMeasureTimeSignature", () => {
  it("全休止 4/4 改为 3/4 时按三个四分休止完整重建", () => {
    const measure = createMeasure([
      createBeat("old-rest-1", 0, "quarter", "rest"),
      createBeat("old-rest-2", 960, "quarter", "rest"),
      createBeat("old-rest-3", 1920, "quarter", "rest"),
      createBeat("old-rest-4", 2880, "quarter", "rest"),
    ]);
    const snapshot = structuredClone(measure);
    const result = changeMeasureTimeSignature(
      measure,
      { numerator: 3, denominator: 4 },
      createIdFactory(),
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.measure.timeSignature).toEqual({
      numerator: 3,
      denominator: 4,
    });
    expect(result.measure.beats).toEqual(
      [0, 960, 1920].map((tick, index) => ({
        id: `new-rest-${index + 1}`,
        tick,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
        notes: [],
      })),
    );
    expect(result.measure.barline).toBe("double");
    expect(measure).toEqual(snapshot);
  });

  it("含真实音符时保留固定前缀 ID，只重建可消费的尾部休止", () => {
    const first = createBeat("note-1", 0, "quarter", "notes");
    const second = createBeat("note-2", 960, "quarter", "notes");
    const measure = createMeasure([
      first,
      second,
      createBeat("old-tail", 1920, "half", "rest"),
    ]);
    const result = changeMeasureTimeSignature(
      measure,
      { numerator: 3, denominator: 4 },
      createIdFactory(),
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.measure.beats.slice(0, 2)).toEqual([first, second]);
    expect(result.measure.beats[0]).toBe(first);
    expect(result.measure.beats[1]).toBe(second);
    expect(result.measure.beats[2]).toMatchObject({
      id: "new-rest-1",
      tick: 1920,
      rhythm: { base: "quarter", dots: 0 },
      kind: "rest",
    });
  });

  it("缩容会切到真实内容时明确失败且不修改输入", () => {
    const measure = createMeasure(
      [0, 960, 1920, 2880].map((tick, index) =>
        createBeat(`note-${index + 1}`, tick, "quarter", "notes"),
      ),
    );
    const snapshot = structuredClone(measure);

    expect(
      changeMeasureTimeSignature(
        measure,
        { numerator: 3, denominator: 4 },
        createIdFactory(),
      ),
    ).toEqual({
      ok: false,
      code: "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE",
    });
    expect(measure).toEqual(snapshot);
  });

  it("拒绝落在新容量之外的和弦标记", () => {
    const measure = createMeasure([createBeat("rest", 0, "whole", "rest")]);
    measure.chordSymbols = [
      {
        id: "late-chord",
        tick: 3000,
        chordDefinitionId: "c-major",
        display: "nameAndDiagram",
      },
    ];

    expect(
      changeMeasureTimeSignature(
        measure,
        { numerator: 3, denominator: 4 },
        createIdFactory(),
      ),
    ).toEqual({
      ok: false,
      code: "CHORD_SYMBOL_OUTSIDE_TIME_SIGNATURE",
    });
  });

  it("3/4 与 6/8 容量相同时保留真实前缀并只更新拍号", () => {
    const note = createBeat("stable-note", 0, "quarter", "notes");
    const measure = createMeasure([
      note,
      createBeat("old-rest", 960, "half", "rest"),
    ]);
    measure.timeSignature = { numerator: 3, denominator: 4 };

    const result = changeMeasureTimeSignature(
      measure,
      { numerator: 6, denominator: 8 },
      createIdFactory(),
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.measure.timeSignature).toEqual({
      numerator: 6,
      denominator: 8,
    });
    expect(result.measure.beats[0]).toBe(note);
    expect(result.measure.beats[1]).toMatchObject({
      tick: 960,
      rhythm: { base: "half", dots: 0 },
      kind: "rest",
    });
  });
});
