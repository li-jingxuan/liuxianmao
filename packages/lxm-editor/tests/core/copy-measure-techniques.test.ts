import { describe, expect, it } from "vitest";
import score from "../../example/example-technique-rhythm";
import example from "../../example/example-mvp2.json";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands";
import { LXM_TECHNIQUE_TYPES } from "../../src/core/constants";
import { loadDocument } from "../../src/core/loader";
import { buildLayout } from "../../src/layout";
import type { ILXMTechnique } from "../../src/core/types";

/** 从原谱引用独立计算是否完整落在小节，避免复用被测复制算法。 */
const isContained = (
  technique: ILXMTechnique,
  beats: Set<string>,
  notes: Set<string>,
) =>
  "fromNoteId" in technique
    ? notes.has(technique.fromNoteId) &&
      (!("toNoteId" in technique) || notes.has(technique.toNoteId))
    : "beatId" in technique
      ? beats.has(technique.beatId)
      : beats.has(technique.fromBeatId) && beats.has(technique.toBeatId);

describe("小节技巧复制保真", () => {
  it.each(score.score.tracks[0]!.measures.map((measure) => [measure.id]))(
    "复制 %s 保留完整技巧并生成独立引用",
    (measureId) => {
      const document = structuredClone(score);
      const before = structuredClone(document);
      const track = document.score.tracks[0]!;
      const source = track.measures.find(
        (measure) => measure.id === measureId,
      )!;
      const local = track.techniques.filter((technique) =>
        isContained(
          technique,
          new Set(source.beats.map((beat) => beat.id)),
          new Set(
            source.beats.flatMap((beat) => beat.notes.map((note) => note.id)),
          ),
        ),
      );
      const result = applyScoreCommand(document, {
        type: LXMScoreCommandEnum.CopyMeasure,
        trackId: track.id,
        measureId: source.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const nextTrack = result.document.score.tracks[0]!;
      const copied = nextTrack.measures[track.measures.indexOf(source) + 1]!;
      const oldIds = new Set(track.techniques.map((technique) => technique.id));
      const techniques = nextTrack.techniques.filter(
        (technique) => !oldIds.has(technique.id),
      );
      expect(techniques.map((technique) => technique.type)).toEqual(
        local.map((technique) => technique.type),
      );
      techniques.forEach((technique, i) => {
        expect(
          isContained(
            technique,
            new Set(copied.beats.map((beat) => beat.id)),
            new Set(
              copied.beats.flatMap((beat) => beat.notes.map((note) => note.id)),
            ),
          ),
        ).toBe(true);
        // 除实体 ID 与目标引用之外，技巧的所有参数必须原样保留。
        const parameters = (value: ILXMTechnique) =>
          Object.fromEntries(
            Object.entries(value).filter(
              ([key]) => !key.endsWith("Id") && key !== "id",
            ),
          );
        expect(parameters(technique)).toEqual(parameters(local[i]!));
      });
      expect(document).toEqual(before);
      expect(result.document.documentRevision).toBe(
        document.documentRevision + 1,
      );
      expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
      const entityIds = nextTrack.measures
        .flatMap((measure) => [
          measure.id,
          ...measure.beats.flatMap((beat) => [
            beat.id,
            ...beat.notes.map((note) => note.id),
          ]),
        ])
        .concat(nextTrack.techniques.map((technique) => technique.id));
      expect(new Set(entityIds).size).toBe(entityIds.length);
      const rendered = buildLayout(result.document, {
        systemWidth: 733,
      }).systems.flatMap((system) =>
        system.techniques.map((technique) => technique.techniqueId),
      );
      techniques.forEach((technique) =>
        expect(rendered).toContain(technique.id),
      );
    },
  );

  it("规范测试谱中 16 类技巧都有完整的小节复制验收样本", () => {
    const track = score.score.tracks[0]!;
    const types = new Set(
      track.measures.flatMap((measure) =>
        track.techniques
          .filter((technique) =>
            isContained(
              technique,
              new Set(measure.beats.map((beat) => beat.id)),
              new Set(
                measure.beats.flatMap((beat) =>
                  beat.notes.map((note) => note.id),
                ),
              ),
            ),
          )
          .map((technique) => technique.type),
      ),
    );
    expect(types).toEqual(new Set(LXM_TECHNIQUE_TYPES));
  });

  it("贯穿小节且两端在外的范围不复制，并报告遗漏而保留原引用", () => {
    const document = structuredClone(example);
    const track = document.score.tracks[0]!;
    track.techniques = [
      {
        id: "spanning-range",
        type: "palmMute",
        fromBeatId: track.measures[0]!.beats[0]!.id,
        toBeatId: track.measures[2]!.beats[0]!.id,
      },
    ];
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.CopyMeasure,
      trackId: track.id,
      measureId: track.measures[1]!.id,
    });
    expect(result).toMatchObject({
      ok: true,
      effects: [
        expect.objectContaining({
          kind: "technique.omitted",
          techniqueId: "spanning-range",
        }),
      ],
    });
    if (result.ok)
      expect(result.document.score.tracks[0]!.techniques).toEqual(
        track.techniques,
      );
  });

  it("复制打断旧跨小节相邻延音线，遗漏与移除分别报告", () => {
    const document = structuredClone(score);
    const track = document.score.tracks[0]!;
    const crossing = track.techniques.find(
      (technique) =>
        technique.type === "tie" &&
        track.measures.some(
          (measure) =>
            "toNoteId" in technique &&
            measure.beats.some((beat) =>
              beat.notes.some((note) => note.id === technique.fromNoteId),
            ) &&
            !measure.beats.some((beat) =>
              beat.notes.some((note) => note.id === technique.toNoteId),
            ),
        ),
    )!;
    const source = track.measures.find(
      (measure) =>
        "fromNoteId" in crossing &&
        measure.beats.some((beat) =>
          beat.notes.some((note) => note.id === crossing.fromNoteId),
        ),
    )!;
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.CopyMeasure,
      trackId: track.id,
      measureId: source.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "technique.omitted",
          techniqueId: crossing.id,
        }),
        expect.objectContaining({
          kind: "technique.removed",
          techniqueId: crossing.id,
        }),
      ]),
    );
    expect(
      result.document.score.tracks[0]!.techniques.some(
        (technique) => technique.id === crossing.id,
      ),
    ).toBe(false);
  });
});
