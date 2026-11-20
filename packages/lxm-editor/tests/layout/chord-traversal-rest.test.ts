import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import DEFAULT_MOCK_DOCUMENT from "../../example/default-score";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands/commands";
import { buildLayout } from "../../src/layout";

const createDocument = () => {
  const document = structuredClone(EXAMPLE_MVP_2);
  // 同时覆盖四分休止和附点八分休止，后者的附点也应随休止符隐藏。
  document.score.tracks[0]!.measures[0]!.beats.slice(0, 2).forEach((beat) => {
    beat.kind = "rest";
    beat.notes = [];
  });
  return document;
};

const traversalParameters = [
  { type: "strum", stroke: "down" },
  { type: "strum", stroke: "up" },
  { type: "arpeggio", direction: "ascending" },
  { type: "arpeggio", direction: "descending" },
] as const;

describe("休止拍上的扫弦和琶音", () => {
  it.each(traversalParameters)(
    "$type $stroke$direction 在《理想》的前八后十六节奏中参与连梁",
    (parameters) => {
      for (const kind of ["rest", "notes"] as const) {
        const document = structuredClone(DEFAULT_MOCK_DOCUMENT);
        const track = document.score.tracks[0]!;
        const measure = track.measures[16]!;
        const [eighth, firstSixteenth, secondSixteenth] = measure.beats;
        eighth!.kind = kind;
        track.techniques = track.techniques.filter((technique) =>
          !("beatId" in technique) || technique.beatId !== eighth!.id,
        );
        const sourceLayout = buildLayout(document);
        const added = applyScoreCommand(document, {
          type: LXMScoreCommandEnum.AddTechnique,
          trackId: track.id,
          technique: { ...parameters, beatId: eighth!.id, minString: 2, maxString: 6 },
        });
        if (!added.ok) throw new Error(added.message);
        const sixteenthIds = [firstSixteenth!.id, secondSixteenth!.id];
        const groupIds = [eighth!.id, ...sixteenthIds];
        for (const purpose of ["editing", "presentation"] as const) {
          const layout = buildLayout(added.document, { purpose });
          const rendered = layout.systems.flatMap((system) => system.measures)
            .find((candidate) => candidate.id === measure.id)!;
          const mark = rendered.durationMarks.find((entry) => entry.beatId === eighth!.id)!;
          expect(mark.flag).toBeNull();
          expect(mark.stemY1).toBeLessThan(mark.stemY2);
          expect(rendered.restMarks.some((rest) => rest.beatId === eighth!.id)).toBe(false);
          expect(rendered.beamSegments.filter((beam) => beam.beatIds.some((id) => groupIds.includes(id))))
            .toMatchObject([
              { kind: "shared", level: 1, beatIds: groupIds, x1: mark.stemX, y: mark.stemY2 },
              { kind: "shared", level: 2, beatIds: sixteenthIds },
            ]);
        }

        expect(added.document.score.tracks[0]!.measures).toEqual(track.measures);
        const removed = applyScoreCommand(added.document, {
          type: LXMScoreCommandEnum.RemoveTechnique,
          trackId: track.id,
          techniqueId: added.document.score.tracks[0]!.techniques.at(-1)!.id,
        });
        if (!removed.ok) throw new Error(removed.message);
        expect(buildLayout(removed.document)).toEqual(sourceLayout);
      }
    },
  );

  it.each(traversalParameters)(
    "$type $stroke$direction 隐藏同拍休止符，移动和删除后恢复原休止符",
    (parameters) => {
      const document = createDocument();
      const original = structuredClone(document);
      const track = document.score.tracks[0]!;
      const [first, second] = track.measures[0]!.beats;
      const draft = {
        ...parameters,
        beatId: first!.id,
        // 即使范围不跨过休止符所在的谱面中部，也隐藏整拍休止符。
        minString: 1,
        maxString: 2,
      };
      const added = applyScoreCommand(document, {
        type: LXMScoreCommandEnum.AddTechnique,
        trackId: track.id,
        technique: draft,
      });
      expect(added).toMatchObject({ ok: true, changed: true });
      if (!added.ok) return;
      const techniqueId = added.document.score.tracks[0]!.techniques[0]!.id;

      for (const purpose of ["editing", "presentation"] as const) {
        const layout = buildLayout(added.document, { purpose });
        const rests = layout.systems.flatMap((system) =>
          system.measures.flatMap((measure) => measure.restMarks),
        );
        expect(rests.map((rest) => rest.beatId)).toEqual([second!.id]);
        expect(layout.systems.flatMap((system) => system.techniques)).toEqual(
          expect.arrayContaining([expect.objectContaining({ techniqueId })]),
        );
      }
      expect(document).toEqual(original);
      expect(added.document.score.tracks[0]!.measures).toEqual(track.measures);

      const moved = applyScoreCommand(added.document, {
        type: LXMScoreCommandEnum.UpdateTechnique,
        trackId: track.id,
        techniqueId,
        technique: { ...draft, beatId: second!.id },
      });
      expect(moved).toMatchObject({ ok: true, changed: true });
      if (!moved.ok) return;
      expect(
        buildLayout(moved.document).systems.flatMap((system) =>
          system.measures.flatMap((measure) =>
            measure.restMarks.map((rest) => rest.beatId),
          ),
        ),
      ).toEqual([first!.id]);

      const removed = applyScoreCommand(moved.document, {
        type: LXMScoreCommandEnum.RemoveTechnique,
        trackId: track.id,
        techniqueId,
      });
      expect(removed).toMatchObject({ ok: true, changed: true });
      if (!removed.ok) return;
      expect(buildLayout(removed.document)).toEqual(buildLayout(original));
    },
  );

  it.each(traversalParameters)(
    "无效的 $type 弦范围保留休止符",
    (parameters) => {
      const document = createDocument();
      document.score.tracks[0]!.techniques = [
        {
          ...parameters,
          id: "invalid-traversal",
          beatId: document.score.tracks[0]!.measures[0]!.beats[0]!.id,
          minString: 1,
          maxString: 1,
        },
      ];
      const layout = buildLayout(document);
      expect(layout.systems.flatMap((system) => system.techniques)).toEqual([]);
      expect(
        layout.systems.flatMap((system) =>
          system.measures.flatMap((measure) => measure.restMarks),
        ),
      ).toHaveLength(2);
    },
  );

  it.each([
    { type: "pickStroke", beatId: "mvp2-beat-1-1", stroke: "down" },
    {
      type: "palmMute",
      fromBeatId: "mvp2-beat-1-1",
      toBeatId: "mvp2-beat-1-2",
    },
    { type: "letRing", fromBeatId: "mvp2-beat-1-1", toBeatId: "mvp2-beat-1-2" },
    { type: "tapping", fromNoteId: "mvp2-note-1-1-6" },
    {
      type: "hammerOn",
      fromNoteId: "mvp2-note-1-1-6",
      toNoteId: "mvp2-note-1-3-5",
    },
  ] as const)("$type 拒绝作用于休止目标", (technique) => {
    const document = createDocument();
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.AddTechnique,
      trackId: document.score.tracks[0]!.id,
      technique,
    });
    expect(result.ok).toBe(false);
    expect(
      buildLayout(document).systems.flatMap((system) =>
        system.measures.flatMap((measure) => measure.restMarks),
      ),
    ).toHaveLength(2);
  });
});
