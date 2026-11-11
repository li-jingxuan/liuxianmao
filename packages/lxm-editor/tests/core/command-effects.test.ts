import { describe, expect, it } from "vitest";
import example from "../../example/example-mvp2.json";
import { collectCommandEffects } from "../../src/core/commands/command-effects";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands/commands";

describe("结构化编辑影响", () => {
  it("按编辑前顺序报告重排小节中的变化，并忽略共享轨道", () => {
    const before = structuredClone(example);
    const track = before.score.tracks[0]!;
    const measures = track.measures.slice(0, 2);
    const after = {
      ...before,
      score: {
        ...before.score,
        tracks: [
          {
            ...track,
            measures: [...measures].reverse().map((measure) => ({
              ...measure,
              beats: measure.beats.map((beat) => ({
                ...beat,
                tick: beat.tick + 1,
              })),
            })),
          },
        ],
      },
    };
    const command = {
      type: LXMScoreCommandEnum.RemoveMeasure,
      trackId: track.id,
      measureId: "unused",
    } as const;
    expect(collectCommandEffects(before, before, command)).toEqual([]);
    expect(collectCommandEffects(before, after, command)).toEqual(
      measures.flatMap((measure, measureIndex) =>
        measure.beats.map((beat, beatIndex) => ({
          kind: "beat.retimed",
          trackId: track.id,
          measureId: measure.id,
          measureNumber: measureIndex + 1,
          beatId: beat.id,
          beatNumber: beatIndex + 1,
          beforeTick: beat.tick,
          afterTick: beat.tick + 1,
        })),
      ),
    );
  });
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
  it("连音组建立和删除返回统一结构 effect", () => {
    const document = structuredClone(example);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    measure.beats.forEach((beat) => {
      beat.rhythm = { base: "eighth", dots: 0 };
      beat.kind = "rest";
      beat.notes = [];
    });
    const set = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetTuplet,
      trackId: track.id,
      measureId: measure.id,
      startBeatId: measure.beats[0]!.id,
      endBeatId: measure.beats[2]!.id,
      ratio: { actual: 3, normal: 2 },
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tuplets.structured",
          operation: "set",
          ratio: { actual: 3, normal: 2 },
          count: 3,
        }),
      ]),
    );
    const group = set.document.score.tracks[0]!.measures[0]!.tuplets[0]!;
    const removed = applyScoreCommand(set.document, {
      type: LXMScoreCommandEnum.RemoveTuplet,
      trackId: track.id,
      measureId: measure.id,
      tupletId: group.id,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tuplets.structured",
          operation: "remove",
          ratio: { actual: 3, normal: 2 },
          count: 3,
        }),
      ]),
    );
  });
});
