import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import { applyScoreCommand } from "../../src/core/commands";
import { buildLayout } from "../../src/layout";

/** 每个测试使用新副本，避免命令结果和 fixture 共享可变引用。 */
const createDocument = () => structuredClone(EXAMPLE_MVP_2);

const target = {
  trackId: "mvp2-track-guitar",
  measureId: "mvp2-measure-1",
  beatId: "mvp2-beat-1-1",
};

describe("applyScoreCommand", () => {
  it("note.set 在空弦新增音符并增加文档修订号", () => {
    const document = createDocument();
    const result = applyScoreCommand(document, {
      type: "note.set",
      ...target,
      string: 1,
      fret: 12,
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;

    const notes = result.document.score.tracks[0]!.measures[0]!.beats[0]!.notes;
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ string: 1, fret: 12 }),
      ]),
    );
    expect(result.document.documentRevision).toBe(
      document.documentRevision + 1,
    );
    expect(document.score.tracks[0]!.measures[0]!.beats[0]!.notes).toHaveLength(
      1,
    );
  });

  it("note.set 覆盖同一弦而不产生重复音符", () => {
    const result = applyScoreCommand(createDocument(), {
      type: "note.set",
      ...target,
      string: 6,
      fret: 9,
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;

    const notes = result.document.score.tracks[0]!.measures[0]!.beats[0]!.notes;
    expect(notes.filter((note) => note.string === 6)).toEqual([
      expect.objectContaining({ fret: 9 }),
    ]);
  });

  it("note.remove 只删除目标弦且允许重复删除", () => {
    const firstResult = applyScoreCommand(createDocument(), {
      type: "note.remove",
      trackId: "mvp2-track-guitar",
      measureId: "mvp2-measure-2",
      beatId: "mvp2-beat-2-1",
      string: 5,
    });
    expect(firstResult).toMatchObject({ ok: true });
    if (!firstResult.ok) return;

    const notes =
      firstResult.document.score.tracks[0]!.measures[1]!.beats[0]!.notes;
    expect(notes).toEqual([expect.objectContaining({ string: 2, fret: 3 })]);

    const secondResult = applyScoreCommand(firstResult.document, {
      type: "note.remove",
      trackId: "mvp2-track-guitar",
      measureId: "mvp2-measure-2",
      beatId: "mvp2-beat-2-1",
      string: 5,
    });
    expect(secondResult).toMatchObject({ ok: true });
  });

  it("删除拍点最后一个音符后仍可重新布局", () => {
    const result = applyScoreCommand(createDocument(), {
      type: "note.remove",
      ...target,
      string: 6,
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;

    const layout = buildLayout(result.document, { systemWidth: 700 });
    const firstMeasure = layout.systems[0]!.measures[0]!;

    expect(
      firstMeasure.durationMarks.some((mark) => mark.beatId === target.beatId),
    ).toBe(false);
  });

  it("拒绝非法弦号、品位和不存在的目标", () => {
    expect(
      applyScoreCommand(createDocument(), {
        type: "note.set",
        ...target,
        string: 7,
        fret: 1,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_STRING" });
    expect(
      applyScoreCommand(createDocument(), {
        type: "note.set",
        ...target,
        string: 1,
        fret: 25,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_FRET" });
    expect(
      applyScoreCommand(createDocument(), {
        type: "note.remove",
        ...target,
        measureId: "missing",
        string: 1,
      }),
    ).toMatchObject({ ok: false, code: "MEASURE_NOT_FOUND" });
  });
});
