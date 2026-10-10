import { describe, expect, it } from "vitest";
import example from "../../example/example-mvp2.json";
import muted from "../../example/example-muted-note";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands";
import { loadDocument } from "../../src/core/loader";
import { LXMDocumentSchema } from "../../src/core/schema";
import {
  findNextNoteOnSameStringInTrack,
  validateTechnique,
} from "../../src/core/technique-rules";
import type { ILXMFret, ILXMTechniqueDraft } from "../../src/core/types";

const command = {
  type: LXMScoreCommandEnum.SetNote as const,
  trackId: "mvp2-track-guitar",
  measureId: "mvp2-measure-1",
  beatId: "mvp2-beat-1-5",
  string: 6,
  fret: "x" as const,
};

/** 在真实连续同弦音中替换中间音，验证 x 是攻击与连接中断而不是空白。 */
const xDocument = () => {
  const document = structuredClone(example);
  document.score.tracks[0]!.measures[0]!.beats[4]!.notes.find(
    (note) => note.string === 6,
  )!.fret = "x";
  return document;
};

describe("闷音 x 领域闭环", () => {
  it("当前数值谱不迁移，schema 4 混合谱可加载，旧 3 明确拒绝", () => {
    const numeric = loadDocument(JSON.stringify(example));
    expect(numeric.ok && numeric.document).toEqual(example);
    expect(loadDocument(JSON.stringify(muted)).ok).toBe(true);
    const old = loadDocument(JSON.stringify({ ...example, schemaVersion: 3 }));
    expect(old).toEqual({
      ok: false,
      errors: ["不支持的文档版本，当前支持 5"],
    });
    expect(
      LXMDocumentSchema.safeParse({ ...example, schemaVersion: 3 }).success,
    ).toBe(false);
  });
  it.each(["X", "", "mute", -1, 25, 1.5, null, undefined, NaN, Infinity])(
    "非法品位 %s 不进入 schema 或命令",
    (value) => {
      const document = xDocument();
      const note = document.score.tracks[0]!.measures[0]!.beats[4]!.notes.find(
        (item) => item.string === 6,
      )!;
      Object.assign(note, { fret: value });
      expect(LXMDocumentSchema.safeParse(document).success).toBe(false);
      const result = applyScoreCommand(example, {
        ...command,
        fret: value as ILXMFret,
      });
      expect(result).toMatchObject({ ok: false, code: "INVALID_FRET" });
    },
  );
  it("数字/x 切换保留 ID 与 tick、no-op 保留引用；失效技巧一次清理并报告", () => {
    const document = structuredClone(example);
    const track = document.score.tracks[0]!;
    track.techniques = [
      {
        id: "x-bend",
        type: "bend",
        fromNoteId: "mvp2-note-1-5-6",
        semitones: 2,
      },
    ];
    const before = structuredClone(document);
    const result = applyScoreCommand(document, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.document.score.tracks[0]!.measures[0]!.beats[4]!.notes.find(
        (note) => note.string === 6,
      ),
    ).toEqual({ id: "mvp2-note-1-5-6", string: 6, fret: "x" });
    expect(
      result.document.score.tracks[0]!.measures[0]!.beats.map((beat) => [
        beat.tick,
        beat.rhythm,
      ]),
    ).toEqual(track.measures[0]!.beats.map((beat) => [beat.tick, beat.rhythm]));
    expect(result.effects).toEqual([
      expect.objectContaining({
        kind: "technique.removed",
        techniqueId: "x-bend",
      }),
    ]);
    expect(result.document.documentRevision).toBe(
      document.documentRevision + 1,
    );
    expect(document).toEqual(before);
    expect(applyScoreCommand(result.document, command)).toEqual({
      ok: true,
      changed: false,
      document: result.document,
    });
    const restored = applyScoreCommand(result.document, {
      ...command,
      fret: 7,
    });
    expect(
      restored.ok && restored.document.score.tracks[0]!.techniques,
    ).toEqual([]);
  });
  it("矩形 x 命令覆盖多拍多弦，仅新增所需 Note，复制完整保持 x", () => {
    const document = structuredClone(example);
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetNotesInRect,
      range: {
        trackId: command.trackId,
        anchor: {
          measureId: command.measureId,
          beatId: "mvp2-beat-1-1",
          string: 1,
        },
        focus: {
          measureId: command.measureId,
          beatId: "mvp2-beat-1-2",
          string: 2,
        },
      },
      fret: "x",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const source = result.document.score.tracks[0]!.measures[0]!;
    source.beats
      .slice(0, 2)
      .forEach((beat) =>
        [1, 2].forEach((string) =>
          expect(beat.notes.find((note) => note.string === string)?.fret).toBe(
            "x",
          ),
        ),
      );
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
    const copied = applyScoreCommand(result.document, {
      type: LXMScoreCommandEnum.CopyMeasure,
      trackId: command.trackId,
      measureId: command.measureId,
    });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(
      copied.document.score.tracks[0]!.measures[1]!.beats.slice(0, 2).map(
        (beat) => beat.notes.map((note) => [note.string, note.fret]),
      ),
    ).toEqual(
      source.beats
        .slice(0, 2)
        .map((beat) => beat.notes.map((note) => [note.string, note.fret])),
    );
  });
  it("休止可输入 x 转为 notes，删除 x 不误变成休止", () => {
    const rested = applyScoreCommand(example, {
      ...command,
      type: LXMScoreCommandEnum.SetBeatKind,
      kind: "rest",
    });
    expect(rested.ok).toBe(true);
    if (!rested.ok) return;
    const set = applyScoreCommand(rested.document, command);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.document.score.tracks[0]!.measures[0]!.beats[4]).toMatchObject({
      kind: "notes",
      notes: [expect.objectContaining({ fret: "x" })],
    });
    const removed = applyScoreCommand(set.document, {
      ...command,
      type: LXMScoreCommandEnum.RemoveNote,
    });
    expect(
      removed.ok && removed.document.score.tracks[0]!.measures[0]!.beats[4],
    ).toMatchObject({ kind: "notes", notes: [] });
  });
  it.each([
    "hammerOn",
    "pullOff",
    "slideUp",
    "slideDown",
    "tie",
    "bend",
    "vibrato",
    "naturalHarmonic",
    "artificialHarmonic",
    "tapping",
    "trill",
  ] as const)("%s 不得作用于 x", (type) => {
    const document = xDocument();
    const track = document.score.tracks[0]!;
    const draft = {
      type,
      fromNoteId: "mvp2-note-1-5-6",
      ...(["hammerOn", "pullOff", "slideUp", "slideDown", "tie"].includes(type)
        ? { toNoteId: "mvp2-note-1-6-6" }
        : {}),
      ...(type === "bend" ? { semitones: 2 } : {}),
      ...(type === "trill" ? { auxiliaryFret: 9 } : {}),
    } as ILXMTechniqueDraft;
    expect(validateTechnique(track, draft)).toMatchObject({
      ok: false,
      error: { code: "TECHNIQUE_TARGET_INVALID" },
    });
    // 外部无效关系不能绕过语义校验进入编辑器。
    if (type === "bend") {
      track.techniques = [
        {
          id: "illegal-x-bend",
          type,
          fromNoteId: "mvp2-note-1-5-6",
          semitones: 2,
        },
      ];
      expect(loadDocument(JSON.stringify(document)).ok).toBe(false);
    }
  });
  it("连接不能跳过同弦 x，两个 x 不能互相延音", () => {
    const document = xDocument();
    const track = document.score.tracks[0]!;
    expect(
      findNextNoteOnSameStringInTrack(track, "mvp2-note-1-1-6")?.note.fret,
    ).toBe("x");
    expect(
      validateTechnique(track, {
        type: "hammerOn",
        fromNoteId: "mvp2-note-1-1-6",
        toNoteId: "mvp2-note-1-6-6",
      }).ok,
    ).toBe(false);
    track.measures[0]!.beats[5]!.notes.find((note) => note.string === 6)!.fret =
      "x";
    expect(
      validateTechnique(track, {
        type: "tie",
        fromNoteId: "mvp2-note-1-5-6",
        toNoteId: "mvp2-note-1-6-6",
      }),
    ).toMatchObject({ ok: false, error: { code: "TECHNIQUE_TARGET_INVALID" } });
  });
  it.each(["pickStroke", "strum", "arpeggio", "palmMute", "letRing"] as const)(
    "%s 保留 Beat/范围上的 x 组合",
    (type) => {
      const document = xDocument();
      const track = document.score.tracks[0]!;
      const beat = track.measures[0]!.beats[4]!;
      if (type === "pickStroke")
        beat.notes = beat.notes.filter((note) => note.string === 6);
      const draft =
        type === "pickStroke"
          ? { type, beatId: beat.id, stroke: "down" as const }
          : type === "strum"
            ? {
                type,
                beatId: beat.id,
                stroke: "down" as const,
                minString: 1,
                maxString: 6,
              }
            : type === "arpeggio"
              ? {
                  type,
                  beatId: beat.id,
                  direction: "ascending" as const,
                  minString: 1,
                  maxString: 6,
                }
              : {
                  type,
                  fromBeatId: beat.id,
                  toBeatId: track.measures[0]!.beats[5]!.id,
                };
      expect(validateTechnique(track, draft).ok).toBe(true);
      expect(
        applyScoreCommand(document, {
          type: LXMScoreCommandEnum.AddTechnique,
          trackId: track.id,
          technique: draft,
        }).ok,
      ).toBe(true);
    },
  );
});
