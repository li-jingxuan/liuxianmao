import { describe, expect, it } from "vitest";
import example from "../../example/example-mvp2.json";
import muted from "../../example/example-muted-note";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands/commands";
import { loadDocument } from "../../src/core/document/loader";
import { LXMDocumentSchema } from "../../src/core/document/schema";
import {
  findNextNoteOnSameStringInTrack,
  validateTechnique,
} from "../../src/core/techniques/technique-rules";
import type { ILXMFret, ILXMTechniqueDraft } from "../../src/core/types";

const command = {
  type: LXMScoreCommandEnum.SetNote as const,
  trackId: "mvp2-track-guitar",
  measureId: "mvp2-measure-1",
  beatId: "mvp2-beat-1-5",
  string: 6,
  fret: "x" as const,
};

/** 在真实连续同弦音中替换中间音，验证 x 保留弹奏与技巧引用。 */
const xDocument = () => {
  const document = structuredClone(example);
  document.score.tracks[0]!.measures[0]!.beats[4]!.notes.find(
    (note) => note.string === 6,
  )!.fret = "x";
  return document;
};

describe("弹奏标记 x 领域闭环", () => {
  it("当前数值谱不迁移，schema 4 混合谱可加载，旧 3 明确拒绝", () => {
    const numeric = loadDocument(JSON.stringify(example));
    expect(numeric.ok && numeric.document).toEqual(example);
    expect(loadDocument(JSON.stringify(muted)).ok).toBe(true);
    const old = loadDocument(JSON.stringify({ ...example, schemaVersion: 3 }));
    expect(old).toEqual({
      ok: false,
      errors: ["不支持的文档版本，当前支持 8"],
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
  it("数字/x 切换保留 ID、tick 与技巧，no-op 保留引用", () => {
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
    expect(result.effects ?? []).toEqual([]);
    expect(result.document.score.tracks[0]!.techniques).toEqual(track.techniques);
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
    ).toEqual(track.techniques);
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
  ] as const)("%s 可作用于 x，命令与加载校验一致", (type) => {
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
    expect(validateTechnique(track, draft)).toEqual({ ok: true });
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.AddTechnique,
      trackId: track.id,
      technique: draft,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  });
  it("连接不能跳过同弦 x，两个相邻 x 可互相延音", () => {
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
    ).toEqual({ ok: true });
  });
  it.each(["hammerOn", "pullOff", "slideUp", "slideDown", "tie"] as const)(
    "%s 不对含 x 的任一端推断数值音高",
    (type) => {
      for (const [fromFret, toFret] of [["x", 0], [0, "x"], ["x", "x"]] as const) {
        const document = xDocument();
        const track = document.score.tracks[0]!;
        track.measures[0]!.beats[4]!.notes.find((n) => n.string === 6)!.fret = fromFret;
        track.measures[0]!.beats[5]!.notes.find((n) => n.string === 6)!.fret = toFret;
        expect(validateTechnique(track, {
          type,
          fromNoteId: "mvp2-note-1-5-6",
          toNoteId: "mvp2-note-1-6-6",
        })).toEqual({ ok: true });
      }
    },
  );
  it("数值品位仍校验 H/P/slide 方向及 Tie 同音", () => {
    const track = xDocument().score.tracks[0]!;
    const from = track.measures[0]!.beats[4]!.notes.find((n) => n.string === 6)!;
    const to = track.measures[0]!.beats[5]!.notes.find((n) => n.string === 6)!;
    from.fret = 5;
    to.fret = 7;
    for (const type of ["pullOff", "slideDown", "tie"] as const) {
      expect(validateTechnique(track, {
        type, fromNoteId: from.id, toNoteId: to.id,
      })).toMatchObject({ ok: false, error: {
        code: type === "tie" ? "TECHNIQUE_REQUIRES_SAME_PITCH" : "TECHNIQUE_DIRECTION_MISMATCH",
      } });
    }
    to.fret = 5;
    for (const type of ["hammerOn", "pullOff", "slideUp", "slideDown"] as const) {
      expect(validateTechnique(track, {
        type, fromNoteId: from.id, toNoteId: to.id,
      })).toMatchObject({ ok: false, error: { code: "TECHNIQUE_DIRECTION_MISMATCH" } });
    }
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
