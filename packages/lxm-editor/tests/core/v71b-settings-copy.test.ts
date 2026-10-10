import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  EXAMPLE_MVP_6_DOCUMENT,
  LXMScoreCommandEnum,
  loadDocument,
} from "../../src";

describe("MVP7.1-B 单轨设置与多小节复制", () => {
  it("设置 capo 和段落标记保持音符与时值不变", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const capo = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetCapo,
      trackId: track.id,
      capo: 3,
    });
    expect(capo.ok && capo.document.score.tracks[0]!.capo).toBe(3);
    const marked = applyScoreCommand(capo.ok ? capo.document : document, {
      type: LXMScoreCommandEnum.SetSectionLabel,
      trackId: track.id,
      measureId: measure.id,
      label: "副歌",
    });
    expect(marked.ok && marked.document.score.tracks[0]!.measures[0]!.sectionLabel).toBe("副歌");
    expect(marked.ok && marked.document.score.tracks[0]!.measures[0]!.beats).toEqual(measure.beats);
  });

  it("多小节复制生成新实体并通过 loader 语义校验", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    const sourceStart = track.measures[0]!;
    const sourceEnd = track.measures[1]!;
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.CopyMeasureRange,
      trackId: track.id,
      sourceStartMeasureId: sourceStart.id,
      sourceEndMeasureId: sourceEnd.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.score.tracks[0]!.measures).toHaveLength(track.measures.length + 2);
    const ids = result.document.score.tracks[0]!.measures.map((measure) => measure.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  });
});
