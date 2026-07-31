import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_4 from "../../example/example-mvp4.json";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
  type ILXMTabCellRange,
} from "../../src/core/commands";
import { validateDocumentSemantics } from "../../src/core/semantic-validation";

const endpoint = (measure: number, beat: number, string: number) => ({
  measureId: `mvp2-measure-${measure}`,
  beatId: `mvp2-beat-${measure}-${beat}`,
  string,
});

const range = (
  anchor: ReturnType<typeof endpoint>,
  focus: ReturnType<typeof endpoint>,
): ILXMTabCellRange => ({
  trackId: "mvp2-track-guitar",
  anchor,
  focus,
});

describe("rect Note commands", () => {
  it("note.setRect 原子设置二维范围且只增加一次 revision", () => {
    const document = structuredClone(EXAMPLE_MVP_4);
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetNotesInRect,
      range: range(endpoint(1, 8, 2), endpoint(2, 2, 4)),
      fret: 7,
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(result.document.documentRevision).toBe(
      document.documentRevision + 1,
    );

    const targetBeatIds = new Set([
      "mvp2-beat-1-8",
      "mvp2-beat-1-9",
      "mvp2-beat-2-1",
      "mvp2-beat-2-2",
    ]);
    const targetBeats = result.document.score.tracks[0]!.measures.flatMap(
      (measure) => measure.beats,
    ).filter((beat) => targetBeatIds.has(beat.id));
    for (const beat of targetBeats) {
      expect(beat.kind).toBe("notes");
      for (const string of [2, 3, 4])
        expect(beat.notes.find((note) => note.string === string)?.fret).toBe(7);
    }
    expect(validateDocumentSemantics(result.document)).toEqual({ ok: true });
    expect(document).toEqual(EXAMPLE_MVP_4);
  });

  it("note.setRect 将 rest 转为 notes，并保留 rhythm/tick", () => {
    const document = structuredClone(EXAMPLE_MVP_4);
    const restBefore = document.score.tracks[0]!.measures[1]!.beats[1]!;
    expect(restBefore).toMatchObject({ kind: "rest", notes: [] });

    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetNotesInRect,
      range: range(endpoint(2, 2, 1), endpoint(2, 2, 3)),
      fret: 12,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;

    const restAfter = result.document.score.tracks[0]!.measures[1]!.beats[1]!;
    expect(restAfter).toMatchObject({
      kind: "notes",
      tick: restBefore.tick,
      rhythm: restBefore.rhythm,
    });
    expect(
      restAfter.notes.map(({ string, fret }) => ({ string, fret })),
    ).toEqual([
      { string: 1, fret: 12 },
      { string: 2, fret: 12 },
      { string: 3, fret: 12 },
    ]);
  });

  it("note.removeRect 只删除目标弦，删除到空仍保持 notes", () => {
    const document = structuredClone(EXAMPLE_MVP_4);
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.RemoveNotesInRect,
      range: range(endpoint(1, 1, 6), endpoint(1, 1, 6)),
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(
      result.document.score.tracks[0]!.measures[0]!.beats[0],
    ).toMatchObject({
      kind: "notes",
      notes: [],
    });
  });

  it("批量命令只复制受影响的 track/measure 分支", () => {
    const document = structuredClone(EXAMPLE_MVP_4);
    const trackBefore = document.score.tracks[0]!;
    const untouchedMeasureBefore = trackBefore.measures[2]!;
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetNotesInRect,
      range: range(endpoint(1, 1, 1), endpoint(2, 1, 1)),
      fret: 5,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;

    const trackAfter = result.document.score.tracks[0]!;
    expect(trackAfter).not.toBe(trackBefore);
    expect(trackAfter.measures[0]).not.toBe(trackBefore.measures[0]);
    expect(trackAfter.measures[1]).not.toBe(trackBefore.measures[1]);
    expect(trackAfter.measures[2]).toBe(untouchedMeasureBefore);
  });

  it("相同品位覆盖和空范围删除是 no-op", () => {
    const first = applyScoreCommand(structuredClone(EXAMPLE_MVP_4), {
      type: LXMScoreCommandEnum.SetNotesInRect,
      range: range(endpoint(1, 1, 1), endpoint(1, 2, 2)),
      fret: 8,
    });
    expect(first).toMatchObject({ ok: true, changed: true });
    if (!first.ok) return;

    const same = applyScoreCommand(first.document, {
      type: LXMScoreCommandEnum.SetNotesInRect,
      range: range(endpoint(1, 1, 1), endpoint(1, 2, 2)),
      fret: 8,
    });
    expect(same).toEqual({
      ok: true,
      changed: false,
      document: first.document,
    });

    const removeEmpty = applyScoreCommand(first.document, {
      type: LXMScoreCommandEnum.RemoveNotesInRect,
      range: range(endpoint(3, 1, 4), endpoint(3, 1, 4)),
    });
    expect(removeEmpty).toEqual({
      ok: true,
      changed: false,
      document: first.document,
    });
  });

  it("非法品位和范围原子失败且不消费原文档", () => {
    const document = structuredClone(EXAMPLE_MVP_4);
    const snapshot = structuredClone(document);
    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.SetNotesInRect,
        range: range(endpoint(1, 1, 1), endpoint(1, 2, 2)),
        fret: 25,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_FRET" });
    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.RemoveNotesInRect,
        range: range(endpoint(1, 1, 1), {
          ...endpoint(1, 2, 2),
          beatId: "missing",
        }),
      }),
    ).toMatchObject({ ok: false, code: "INVALID_TAB_CELL_RANGE" });
    expect(document).toEqual(snapshot);
  });
});
