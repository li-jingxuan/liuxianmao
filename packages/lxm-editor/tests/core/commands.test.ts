import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
  type ILXMScoreCommand,
} from "../../src/core/commands";
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
      type: LXMScoreCommandEnum.SetNote,
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
      type: LXMScoreCommandEnum.SetNote,
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

  it("单点 Note、rhythm 和 kind 的 no-op 保留原引用与 revision", () => {
    const document = createDocument();
    const commands: ILXMScoreCommand[] = [
      {
        type: LXMScoreCommandEnum.SetNote,
        ...target,
        string: 6,
        fret: 0,
      },
      {
        type: LXMScoreCommandEnum.RemoveNote,
        ...target,
        string: 1,
      },
      {
        type: LXMScoreCommandEnum.SetBeatRhythm,
        ...target,
        rhythm: { base: "quarter" as const, dots: 0 },
      },
      {
        type: LXMScoreCommandEnum.SetBeatKind,
        ...target,
        kind: "notes" as const,
      },
    ];

    for (const command of commands) {
      const result = applyScoreCommand(document, command);
      expect(result).toEqual({ ok: true, changed: false, document });
      if (result.ok)
        expect(result.document.documentRevision).toBe(
          document.documentRevision,
        );
    }
  });

  it("note.remove 只删除目标弦且允许重复删除", () => {
    const firstResult = applyScoreCommand(createDocument(), {
      type: LXMScoreCommandEnum.RemoveNote,
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
      type: LXMScoreCommandEnum.RemoveNote,
      trackId: "mvp2-track-guitar",
      measureId: "mvp2-measure-2",
      beatId: "mvp2-beat-2-1",
      string: 5,
    });
    expect(secondResult).toEqual({
      ok: true,
      changed: false,
      document: firstResult.document,
    });
  });

  it("删除拍点最后一个音符后仍可重新布局", () => {
    const result = applyScoreCommand(createDocument(), {
      type: LXMScoreCommandEnum.RemoveNote,
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
        type: LXMScoreCommandEnum.SetNote,
        ...target,
        string: 7,
        fret: 1,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_STRING" });
    expect(
      applyScoreCommand(createDocument(), {
        type: LXMScoreCommandEnum.SetNote,
        ...target,
        string: 1,
        fret: 25,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_FRET" });
    expect(
      applyScoreCommand(createDocument(), {
        type: LXMScoreCommandEnum.RemoveNote,
        ...target,
        measureId: "missing",
        string: 1,
      }),
    ).toMatchObject({ ok: false, code: "MEASURE_NOT_FOUND" });
  });

  it("note.set 自动取消休止并在同一次命令中写入音符", () => {
    const restResult = applyScoreCommand(createDocument(), {
      type: LXMScoreCommandEnum.SetBeatKind,
      ...target,
      kind: "rest",
    });
    expect(restResult).toMatchObject({ ok: true });
    if (!restResult.ok) return;
    expect(
      restResult.document.score.tracks[0]!.measures[0]!.beats[0],
    ).toMatchObject({ kind: "rest", notes: [] });

    const restDocument = structuredClone(restResult.document);
    const noteResult = applyScoreCommand(restResult.document, {
      type: LXMScoreCommandEnum.SetNote,
      ...target,
      string: 1,
      fret: 3,
    });
    expect(noteResult).toMatchObject({ ok: true });
    if (!noteResult.ok) return;

    const nextBeat =
      noteResult.document.score.tracks[0]!.measures[0]!.beats[0]!;
    expect(nextBeat).toMatchObject({
      id: target.beatId,
      kind: "notes",
      notes: [expect.objectContaining({ string: 1, fret: 3 })],
    });
    expect(nextBeat.tick).toBe(
      restDocument.score.tracks[0]!.measures[0]!.beats[0]!.tick,
    );
    expect(nextBeat.rhythm).toEqual(
      restDocument.score.tracks[0]!.measures[0]!.beats[0]!.rhythm,
    );
    expect(noteResult.document.documentRevision).toBe(
      restResult.document.documentRevision + 1,
    );
    expect(restResult.document).toEqual(restDocument);

    const layout = buildLayout(noteResult.document, { systemWidth: 700 });
    const firstMeasure = layout.systems[0]!.measures[0]!;
    const beatLayout = firstMeasure.beats.find(
      (beat) => beat.id === target.beatId,
    )!;
    const noteLayout = firstMeasure.notes.find(
      (note) => note.beatId === target.beatId && note.string === 1,
    )!;
    expect(
      firstMeasure.restMarks.some((rest) => rest.beatId === target.beatId),
    ).toBe(false);
    expect(noteLayout.x).toBe(beatLayout.x);
  });

  it("休止拍输入非法品位时保持休止状态", () => {
    const restResult = applyScoreCommand(createDocument(), {
      type: LXMScoreCommandEnum.SetBeatKind,
      ...target,
      kind: "rest",
    });
    expect(restResult).toMatchObject({ ok: true });
    if (!restResult.ok) return;
    const snapshot = structuredClone(restResult.document);

    expect(
      applyScoreCommand(restResult.document, {
        type: LXMScoreCommandEnum.SetNote,
        ...target,
        string: 1,
        fret: 25,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_FRET" });
    expect(restResult.document).toEqual(snapshot);
  });

  it("缩短时值会补充尾部休止以保持小节容量", () => {
    const result = applyScoreCommand(createDocument(), {
      type: LXMScoreCommandEnum.SetBeatRhythm,
      ...target,
      rhythm: { base: "eighth", dots: 0 },
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const beats = result.document.score.tracks[0]!.measures[0]!.beats;
    expect(beats.at(-1)).toMatchObject({ kind: "rest" });
    expect(
      buildLayout(result.document, { systemWidth: 700 }).systems,
    ).not.toHaveLength(0);
  });

  it("变长溢出时自动压缩同小节内最近的后续 beat", () => {
    const result = applyScoreCommand(createDocument(), {
      type: LXMScoreCommandEnum.SetBeatRhythm,
      trackId: "mvp2-track-guitar",
      measureId: "mvp2-measure-6",
      beatId: "mvp2-beat-6-1",
      rhythm: { base: "quarter", dots: 0 },
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const measure = result.document.score.tracks[0]!.measures[5]!;
    expect(measure.beats.slice(0, 4).map((beat) => beat.rhythm.base)).toEqual([
      "quarter",
      "thirtySecond",
      "thirtySecond",
      "sixteenth",
    ]);
    expect(
      buildLayout(result.document, { systemWidth: 700 }).systems,
    ).not.toHaveLength(0);
  });

  it("后续 beat 无法容纳增长时返回明确错误且保持文档不变", () => {
    const document = createDocument();
    const snapshot = structuredClone(document);
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetBeatRhythm,
      trackId: "mvp2-track-guitar",
      measureId: "mvp2-measure-6",
      beatId: "mvp2-beat-6-7",
      rhythm: { base: "half", dots: 0 },
    });

    expect(result).toEqual({
      ok: false,
      code: "FOLLOWING_BEATS_CANNOT_COMPRESS",
      message:
        "后续节拍已达到最短可用时值，无法容纳当前修改，请先将后续节拍调整为休止符。",
    });
    expect(document).toEqual(snapshot);
  });

  it("新增、复制、删除小节均保持可编辑文档", () => {
    const document = createDocument();
    const snapshot = structuredClone(document);
    const inserted = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.InsertMeasure,
      trackId: target.trackId,
      afterMeasureId: target.measureId,
    });
    expect(inserted).toMatchObject({ ok: true });
    if (!inserted.ok) return;
    const insertedTrack = inserted.document.score.tracks[0]!;
    const insertedMeasure = insertedTrack.measures[1]!;
    expect(insertedMeasure.timeSignature).toEqual({
      numerator: 4,
      denominator: 4,
    });
    expect(insertedMeasure.beats).toHaveLength(4);
    expect(
      insertedMeasure.beats.map(({ tick, rhythm, kind, notes }) => ({
        tick,
        rhythm,
        kind,
        notes,
      })),
    ).toEqual(
      [0, 960, 1920, 2880].map((tick) => ({
        tick,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
        notes: [],
      })),
    );
    expect(inserted.document.documentRevision).toBe(
      document.documentRevision + 1,
    );
    expect(document).toEqual(snapshot);
    expect(
      buildLayout(inserted.document, { systemWidth: 700 }).systems,
    ).not.toHaveLength(0);

    const copied = applyScoreCommand(inserted.document, {
      type: LXMScoreCommandEnum.CopyMeasure,
      trackId: target.trackId,
      measureId: target.measureId,
    });
    expect(copied).toMatchObject({ ok: true });
    if (!copied.ok) return;
    const removed = applyScoreCommand(copied.document, {
      type: LXMScoreCommandEnum.RemoveMeasure,
      trackId: target.trackId,
      measureId: target.measureId,
    });
    expect(removed).toMatchObject({ ok: true });
  });
});
