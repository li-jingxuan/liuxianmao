import { describe, expect, it } from "vitest";
import example from "../../example/example-mvp2.json";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands";

describe("结构化编辑影响", () => {
  it("只报告后续压缩，并附带起点重排；不把主动目标时值当成副作用", () => {
    const document = structuredClone(example);
    const track = document.score.tracks[0]!;
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetBeatRhythm,
      trackId: track.id,
      measureId: "mvp2-measure-6",
      beatId: "mvp2-beat-6-1",
      rhythm: { base: "quarter", dots: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.effects
        ?.filter((effect) => effect.kind === "beat.compressed")
        .map((effect) => "beatId" in effect && effect.beatId),
    ).toEqual(["mvp2-beat-6-2", "mvp2-beat-6-3", "mvp2-beat-6-4"]);
    expect(
      result.effects?.some((effect) => effect.kind === "beat.retimed"),
    ).toBe(true);
    expect(JSON.stringify(result.document)).not.toContain('"effects"');
    const noop = applyScoreCommand(result.document, {
      type: LXMScoreCommandEnum.SetBeatRhythm,
      trackId: track.id,
      measureId: "mvp2-measure-6",
      beatId: "mvp2-beat-6-1",
      rhythm: { base: "quarter", dots: 0 },
    });
    expect(noop).toEqual({
      ok: true,
      changed: false,
      document: result.document,
    });
  });
  it("自动清理技巧有报告，主动删除相同技巧不产生影响报告", () => {
    const document = structuredClone(example);
    const track = document.score.tracks[0]!;
    track.techniques = [
      {
        id: "bend-effect",
        type: "bend",
        fromNoteId: "mvp2-note-1-5-6",
        semitones: 2,
      },
    ];
    const explicit = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.RemoveTechnique,
      trackId: track.id,
      techniqueId: "bend-effect",
    });
    expect(explicit.ok && explicit.effects).toBeUndefined();
    const removed = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.RemoveNote,
      trackId: track.id,
      measureId: "mvp2-measure-1",
      beatId: "mvp2-beat-1-5",
      string: 6,
    });
    expect(removed).toMatchObject({
      ok: true,
      effects: [
        expect.objectContaining({
          kind: "technique.removed",
          techniqueId: "bend-effect",
        }),
      ],
    });
    const removedMeasure = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.RemoveMeasure,
      trackId: track.id,
      measureId: "mvp2-measure-1",
    });
    expect(removedMeasure).toMatchObject({
      ok: true,
      effects: [
        expect.objectContaining({
          kind: "technique.removed",
          techniqueId: "bend-effect",
        }),
      ],
    });
    const failed = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.RemoveNote,
      trackId: "missing",
      measureId: "missing",
      beatId: "missing",
      string: 1,
    });
    expect(failed.ok).toBe(false);
    expect(failed).not.toHaveProperty("effects");
  });
});
