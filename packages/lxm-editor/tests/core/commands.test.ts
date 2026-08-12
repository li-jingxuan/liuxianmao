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

/**
 * 拍号范围测试使用全休止小节，避免 fixture 中真实音符主动触发保守缩容拒绝。
 * 每个 ID 包含小节和拍序号，保证最终 semantic validation 仍能检查全局唯一性。
 */
const createAllRestDocument = () => {
  const document = createDocument();
  document.score.tracks[0]!.measures.forEach((measure, measureIndex) => {
    measure.chordSymbols = [];
    measure.beats = [0, 960, 1920, 2880].map((tick, beatIndex) => ({
      id: `time-signature-rest-${measureIndex + 1}-${beatIndex + 1}`,
      tick,
      rhythm: { base: "quarter" as const, dots: 0 },
      kind: "rest" as const,
      notes: [],
    }));
  });
  return document;
};

const target = {
  trackId: "mvp2-track-guitar",
  measureId: "mvp2-measure-1",
  beatId: "mvp2-beat-1-1",
};

describe("applyScoreCommand", () => {
  it("原子设置谱首和小节右边界，并对 no-op 保留原文档", () => {
    const document = createDocument();
    const startResult = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetBarlineBoundary,
      trackId: target.trackId,
      boundary: { kind: "trackStart" },
      barline: "repeatStart",
    });
    expect(startResult).toMatchObject({ ok: true, changed: true });
    if (!startResult.ok) return;
    expect(startResult.document.score.tracks[0]!.startBarline).toBe(
      "repeatStart",
    );

    const boundaryResult = applyScoreCommand(startResult.document, {
      type: LXMScoreCommandEnum.SetBarlineBoundary,
      trackId: target.trackId,
      boundary: { kind: "afterMeasure", measureId: target.measureId },
      barline: "repeatBoth",
    });
    expect(boundaryResult).toMatchObject({ ok: true, changed: true });
    if (!boundaryResult.ok) return;
    expect(boundaryResult.document.score.tracks[0]!.measures[0]!.barline).toBe(
      "repeatBoth",
    );

    const noOp = applyScoreCommand(boundaryResult.document, {
      type: LXMScoreCommandEnum.SetBarlineBoundary,
      trackId: target.trackId,
      boundary: { kind: "afterMeasure", measureId: target.measureId },
      barline: "repeatBoth",
    });
    expect(noOp).toEqual({
      ok: true,
      changed: false,
      document: boundaryResult.document,
    });
  });

  it("拒绝边界不支持的类型和谱尾开始反复", () => {
    const document = createDocument();
    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.SetBarlineBoundary,
        trackId: target.trackId,
        boundary: { kind: "trackStart" },
        barline: "final",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_BARLINE_FOR_BOUNDARY" });

    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.SetBarlineBoundary,
        trackId: target.trackId,
        boundary: { kind: "afterMeasure", measureId: "mvp2-measure-8" },
        barline: "repeatStart",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_BARLINE_FOR_BOUNDARY" });
  });

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

  it("从第四小节建立持续 3/4 段落且整批只增加一次 revision", () => {
    const document = createAllRestDocument();
    const track = document.score.tracks[0]!;
    const originalReferences = [...track.measures];
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetTimeSignature,
      trackId: track.id,
      measureId: track.measures[3]!.id,
      timeSignature: { numerator: 3, denominator: 4 },
      scope: "untilNextChange",
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    const nextMeasures = result.document.score.tracks[0]!.measures;
    expect(
      nextMeasures.map(
        (measure) =>
          `${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`,
      ),
    ).toEqual(["4/4", "4/4", "4/4", "3/4", "3/4", "3/4", "3/4", "3/4"]);
    expect(result.document.documentRevision).toBe(
      document.documentRevision + 1,
    );
    // 范围外小节保持原引用；范围内小节才被不可变替换。
    expect(nextMeasures[0]).toBe(originalReferences[0]);
    expect(nextMeasures[2]).toBe(originalReferences[2]);
    expect(nextMeasures[3]).not.toBe(originalReferences[3]);
  });

  it("仅当前小节变拍会保留相邻小节并形成恢复拍号显示", () => {
    const document = createAllRestDocument();
    const track = document.score.tracks[0]!;
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetTimeSignature,
      trackId: track.id,
      measureId: track.measures[3]!.id,
      timeSignature: { numerator: 3, denominator: 4 },
      scope: "measure",
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    const nextTrack = result.document.score.tracks[0]!;
    expect(nextTrack.measures[3]!.timeSignature).toEqual({
      numerator: 3,
      denominator: 4,
    });
    expect(nextTrack.measures[4]!.timeSignature).toEqual({
      numerator: 4,
      denominator: 4,
    });

    const timeSignatures = buildLayout(result.document, {
      systemWidth: 2000,
    }).systems.flatMap((system) =>
      system.measures.flatMap((measure) =>
        measure.timeSignature
          ? [
              `${measure.timeSignature.numerator.text}/${measure.timeSignature.denominator.text}`,
            ]
          : [],
      ),
    );
    expect(timeSignatures).toEqual(["4/4", "3/4", "4/4"]);
  });

  it("持续范围在命令前已有的下一拍号变化点停止", () => {
    const document = createAllRestDocument();
    const track = document.score.tracks[0]!;
    track.measures.slice(4).forEach((measure) => {
      measure.timeSignature = { numerator: 3, denominator: 4 };
      measure.beats = [0, 960, 1920].map((tick, index) => ({
        id: `existing-three-four-${measure.id}-${index}`,
        tick,
        rhythm: { base: "quarter" as const, dots: 0 },
        kind: "rest" as const,
        notes: [],
      }));
    });

    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetTimeSignature,
      trackId: track.id,
      measureId: track.measures[2]!.id,
      timeSignature: { numerator: 6, denominator: 8 },
      scope: "untilNextChange",
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(
      result.document.score.tracks[0]!.measures.map(
        (measure) => measure.timeSignature,
      ),
    ).toEqual([
      { numerator: 4, denominator: 4 },
      { numerator: 4, denominator: 4 },
      { numerator: 6, denominator: 8 },
      { numerator: 6, denominator: 8 },
      { numerator: 3, denominator: 4 },
      { numerator: 3, denominator: 4 },
      { numerator: 3, denominator: 4 },
      { numerator: 3, denominator: 4 },
    ]);
  });

  it("多小节中任一真实内容溢出时整条命令原子失败", () => {
    const document = createAllRestDocument();
    const originalFixture = createDocument();
    // 第二小节恢复为填满 4/4 的真实八分音符，确保 3/4 缩容必然切到内容。
    document.score.tracks[0]!.measures[1] =
      originalFixture.score.tracks[0]!.measures[1]!;
    const snapshot = structuredClone(document);
    const firstMeasureReference = document.score.tracks[0]!.measures[0];

    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetTimeSignature,
      trackId: target.trackId,
      measureId: document.score.tracks[0]!.measures[0]!.id,
      timeSignature: { numerator: 3, denominator: 4 },
      scope: "untilNextChange",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE",
    });
    expect(document).toEqual(snapshot);
    expect(document.score.tracks[0]!.measures[0]).toBe(firstMeasureReference);
  });

  it("拒绝非白名单拍号并让相同拍号保持 no-op", () => {
    const document = createAllRestDocument();
    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.SetTimeSignature,
        trackId: target.trackId,
        measureId: target.measureId,
        timeSignature: { numerator: 5, denominator: 8 },
        scope: "measure",
      }),
    ).toMatchObject({ ok: false, code: "UNSUPPORTED_TIME_SIGNATURE" });

    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.SetTimeSignature,
        trackId: target.trackId,
        measureId: target.measureId,
        timeSignature: { numerator: 4, denominator: 4 },
        scope: "untilNextChange",
      }),
    ).toEqual({ ok: true, changed: false, document });
  });
});
