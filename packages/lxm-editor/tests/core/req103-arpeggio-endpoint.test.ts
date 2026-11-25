import { describe, expect, it } from "vitest";
import source from "../../example/example-mvp2.json";
import {
  applyScoreCommand,
  createDocumentHistory,
  LXMScoreCommandEnum,
  transitionDocumentHistory,
  type ILXMSetArpeggioEndpointCommand,
  type ILXMTrack,
} from "../../src/public";

const fixture = () => {
  const document = structuredClone(source);
  const track = document.score.tracks[0]!;
  const ascending = { id: "asc", type: "arpeggio", beatId: "mvp2-beat-1-1", minString: 1, maxString: 4, direction: "ascending" } as const;
  const descending = { id: "desc", type: "arpeggio", beatId: "mvp2-beat-2-1", minString: 4, maxString: 6, direction: "descending" } as const;
  const strum = { id: "strum", type: "strum", beatId: "mvp2-beat-1-2", minString: 1, maxString: 2, stroke: "down" } as const;
  track.techniques = [ascending, strum, descending];
  const otherTrack: ILXMTrack = {
    ...track,
    id: "other-track",
    measures: [{
      ...track.measures[0]!,
      id: "other-measure",
      beats: [{ id: "other-beat", tick: 0, kind: "rest", rhythm: { base: "whole", dots: 0 }, notes: [] }],
      chordSymbols: [],
    }],
    techniques: [{ ...ascending, id: "other-arpeggio", beatId: "other-beat" }],
  };
  document.score.tracks.push(otherTrack);

  const command: ILXMSetArpeggioEndpointCommand = {
    type: LXMScoreCommandEnum.SetArpeggioEndpoint,
    trackId: track.id,
    techniqueIds: [ascending.id, descending.id, ascending.id],
    endpoint: "minString",
    string: 2,
  };
  return { document, track, otherTrack, ascending, descending, strum, command };
};

describe("REQ-103 琶音端点命令", () => {
  it.each([["minString", 2], ["maxString", 5]] as const)(
    "跨小节批量调整 %s，保留各自另一端、方向和稳定 ID",
    (endpoint, string) => {
      const { document, track, otherTrack, ascending, descending, strum, command } = fixture();
      const before = structuredClone(document);
      const result = applyScoreCommand(document, { ...command, endpoint, string });
      if (!result.ok) throw new Error(`${result.code} ${result.message}`);

      const [updated, untouched] = result.document.score.tracks;
      expect(updated!.techniques).toEqual([
        { ...ascending, [endpoint]: string }, strum, { ...descending, [endpoint]: string },
      ]);
      expect(updated!.techniques[1]).toBe(strum);
      expect(updated!.measures).toBe(track.measures);
      expect(untouched).toBe(otherTrack);
      expect(result.changed).toBe(true);
      expect(result.effects).toBeUndefined();
      expect(result.document.documentRevision).toBe(document.documentRevision + 1);
      expect(document).toEqual(before);
    },
  );

  it("拒绝不存在的目标、跨轨目标和混入的扫弦，保留两根弦的下限", () => {
    const { document, command } = fixture();
    const before = structuredClone(document);
    for (const id of ["missing", "other-arpeggio"]) {
      expect(applyScoreCommand(document, { ...command, techniqueIds: ["asc", id] })).toMatchObject({
        ok: false, code: "TECHNIQUE_NOT_FOUND",
      });
    }
    expect(applyScoreCommand(document, { ...command, techniqueIds: ["asc", "strum"] })).toMatchObject({
      ok: false, code: "TECHNIQUE_TARGET_INVALID", message: "只能修改琶音技巧的弦线范围",
    });
    expect(applyScoreCommand(document, { ...command, type: LXMScoreCommandEnum.SetStrumEndpoint })).toMatchObject({
      ok: false, code: "TECHNIQUE_TARGET_INVALID", message: "只能修改扫弦技巧的弦线范围",
    });
    // 第一项可调，第二项会缩到一根弦或跨过另一端，整批应失败。
    for (const string of [4, 3]) {
      expect(applyScoreCommand(document, { ...command, endpoint: "maxString", string })).toMatchObject({
        ok: false, code: "TECHNIQUE_TARGET_INVALID",
      });
    }
    for (const string of [0, 7, 2.5]) {
      expect(applyScoreCommand(document, { ...command, string })).toMatchObject({ ok: false, code: "INVALID_STRING" });
    }
    expect(document).toEqual(before);
  });

  it("校验整批端点与已有延音线，保留仍有公共弦的延音线，拒绝断开连接", () => {
    const { document, track, command, ascending, strum } = fixture();
    track.measures[0]!.beats[0]!.notes = [];
    const tie = { id: "tie", type: "traversalTie", fromBeatId: ascending.beatId, toBeatId: strum.beatId } as const;
    track.techniques.push(tie);
    const before = structuredClone(document);

    const overlap = applyScoreCommand(document, command);
    if (!overlap.ok) throw new Error(`${overlap.code} ${overlap.message}`);
    expect(overlap.document.score.tracks[0]!.techniques.at(-1)).toBe(tie);
    expect(overlap.effects).toBeUndefined();
    expect(applyScoreCommand(document, { ...command, string: 3 })).toMatchObject({
      ok: false, code: "SEMANTIC_VALIDATION_FAILED",
    });
    expect(document).toEqual(before);
  });

  it.each([
    [["strum", "asc", "desc"], "minString", 3],
    [["desc", "asc", "strum"], "maxString", 5],
  ] as const)("BUG-084 混选 %j 对齐 %s 并一次撤销和重做", (techniqueIds, endpoint, string) => {
    const { document, track } = fixture();
    track.techniques = track.techniques.map(technique => technique.type === "strum" ? { ...technique, maxString: 5 } : technique);
    const command = { type: LXMScoreCommandEnum.SetTraversalEndpoint, trackId: track.id, techniqueIds, endpoint, string } as const;
    const before = structuredClone(document);
    const result = applyScoreCommand(document, command);
    if (!result.ok) throw new Error(`${result.code} ${result.message}`);
    expect(result.changed).toBe(true);
    expect(result.document.documentRevision).toBe(document.documentRevision + 1);
    expect(result.document.score.tracks[0]!.techniques).toEqual(track.techniques.map(technique => ({ ...technique, [endpoint]: string })));
    expect(document).toEqual(before);
    let history = transitionDocumentHistory(createDocumentHistory<typeof command.type>(), {
      type: "commit", document, entry: command.type,
    });
    expect(history.past).toEqual([document]);
    const restored = history.past[0]!;
    history = transitionDocumentHistory(history, { type: "undo", document: result.document, keepCount: 0 });
    expect(restored).toBe(document);
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([result.document]);
    const redone = history.future[0]!;
    history = transitionDocumentHistory(history, { type: "redo", document: restored });
    expect(redone).toBe(result.document);
    expect(history.past).toEqual([restored]);
    expect(history.future).toEqual([]);

    for (const patch of [{}, { techniqueIds: [] }]) {
      const unchanged = applyScoreCommand(redone, { ...command, ...patch });
      expect(unchanged).toEqual({ ok: true, changed: false, document: redone });
      if (unchanged.ok) expect(unchanged.document).toBe(redone);
    }
  });

  it("BUG-084 琶音或扫弦的对端都限制整组，任一范围非法时原子拒绝", () => {
    const { document, track } = fixture();
    const before = structuredClone(document);
    const command = { type: LXMScoreCommandEnum.SetTraversalEndpoint, trackId: track.id } as const;
    // 上端受扫弦第 2 弦限制，下端受第 4 弦起的琶音限制，另一种类型本来可编辑。
    expect(applyScoreCommand(document, { ...command, techniqueIds: ["asc", "strum"], endpoint: "minString", string: 2 }))
      .toMatchObject({ ok: false, code: "TECHNIQUE_TARGET_INVALID" });
    expect(applyScoreCommand(document, { ...command, techniqueIds: ["strum", "desc"], endpoint: "maxString", string: 4 }))
      .toMatchObject({ ok: false, code: "TECHNIQUE_TARGET_INVALID" });
    expect(document).toEqual(before);
  });
});
