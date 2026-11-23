import { describe, expect, it } from "vitest";
import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
  type ILXMSetStrumEndpointCommand,
} from "../../src/core/commands/commands";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_2);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  track.techniques = [
    { id: "down", type: "strum", beatId: "mvp2-beat-1-1", minString: 1, maxString: 4, stroke: "down" },
    { id: "unselected", type: "strum", beatId: "mvp2-beat-1-3", minString: 1, maxString: 6, stroke: "up" },
    { id: "up", type: "strum", beatId: "mvp2-beat-2-1", minString: 3, maxString: 6, stroke: "up", showFrets: true },
    { id: "arpeggio", type: "arpeggio", beatId: "mvp2-beat-1-2", minString: 4, maxString: 6, direction: "ascending" },
  ];
  const otherTrack = {
    ...track,
    id: "other-track",
    measures: [{
      ...measure,
      id: "other-measure",
      beats: [{ id: "other-beat", tick: 0, kind: "rest", rhythm: { base: "whole", dots: 0 }, notes: [] }],
      chordSymbols: [],
    }],
    techniques: [{ id: "other-strum", type: "strum", beatId: "other-beat", minString: 1, maxString: 6, stroke: "down" }],
  } satisfies typeof track;
  document.score.tracks.push(otherTrack);

  const command: ILXMSetStrumEndpointCommand = {
    type: LXMScoreCommandEnum.SetStrumEndpoint,
    trackId: track.id,
    techniqueIds: ["down", "up", "down"],
    endpoint: "minString",
    string: 2,
  };
  return { document, track, otherTrack, command };
};

describe("扫弦端点命令", () => {
  it.each([["minString", 2], ["maxString", 5]] as const)(
    "一次修改跨小节选中扫弦的 %s，保留另一端、方向、音组和其余事件",
    (endpoint, string) => {
      const { document, track, otherTrack, command } = fixture();
      const before = structuredClone(document);
      const result = applyScoreCommand(document, { ...command, endpoint, string });
      expect(result).toMatchObject({ ok: true, changed: true });
      if (!result.ok) return;

      const [updated, untouched] = result.document.score.tracks;
      const [down, unselected, up, arpeggio] = track.techniques;
      expect(updated?.techniques).toEqual([
        { ...down, [endpoint]: string }, unselected, { ...up, [endpoint]: string }, arpeggio,
      ]);
      expect(updated?.techniques[1]).toBe(unselected);
      expect(updated?.techniques[3]).toBe(arpeggio);
      expect(updated?.measures).toBe(track.measures);
      expect(untouched).toBe(otherTrack);
      expect(result.document.documentRevision).toBe(document.documentRevision + 1);
      expect(document).toEqual(before);
    },
  );

  it("端点没有变化或显式选区为空时保留原文档", () => {
    const { document, command } = fixture();
    for (const patch of [{ techniqueIds: ["down"], string: 1 }, { techniqueIds: [] }]) {
      const result = applyScoreCommand(document, { ...command, ...patch });
      expect(result).toMatchObject({ ok: true, changed: false });
      if (result.ok) expect(result.document).toBe(document);
    }
  });

  it("任一目标失效或范围非法时拒绝整次修改", () => {
    const { document, command } = fixture();
    const before = structuredClone(document);
    for (const id of ["missing", "other-strum", "arpeggio"]) {
      expect(applyScoreCommand(document, { ...command, techniqueIds: ["down", id] })).toMatchObject({
        ok: false, code: id === "arpeggio" ? "TECHNIQUE_TARGET_INVALID" : "TECHNIQUE_NOT_FOUND",
      });
    }
    expect(applyScoreCommand(document, { ...command, endpoint: "maxString", string: 3 })).toMatchObject({
      ok: false, code: "TECHNIQUE_TARGET_INVALID",
    });
    for (const string of [0, 7, 2.5]) {
      expect(applyScoreCommand(document, { ...command, string })).toMatchObject({ ok: false, code: "INVALID_STRING" });
    }
    expect(document).toEqual(before);
  });

  it("保留已有延音线，若新范围不再重叠则拒绝修改", () => {
    const { document, track, command } = fixture();
    track.measures[0]!.beats[0]!.notes = [];
    const tie = { id: "tie", type: "traversalTie", fromBeatId: "mvp2-beat-1-1", toBeatId: "mvp2-beat-1-2" } as const;
    track.techniques.push(tie);
    const overlap = applyScoreCommand(document, command);
    expect(overlap).toMatchObject({ ok: true, changed: true });
    if (overlap.ok) expect(overlap.document.score.tracks[0]!.techniques.at(-1)).toBe(tie);

    const shorten = { ...command, techniqueIds: ["down"], endpoint: "maxString", string: 3 } as const;
    expect(applyScoreCommand(document, shorten)).toMatchObject({ ok: false, code: "SEMANTIC_VALIDATION_FAILED" });
    expect(track.techniques.at(-1)).toBe(tie);
    expect(track.techniques[0]).toMatchObject({ maxString: 4 });
  });
});
