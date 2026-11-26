import { readScoreTonality, type ILXMDocument } from "@liuxianmao/lxm-editor-react";
import type { LibraryEntry, ScoreSummary } from "../electron/library-types.cjs";

/** 从同一份经过编辑器校验的快照投影摘要。旧谱未明确大小调时沿用谱内数字 1。 */
export function summarizeScore(document: ILXMDocument): ScoreSummary {
  const { score } = document;
  const tonality = readScoreTonality(document);
  const measures = score.tracks[0].measures;
  const { numerator, denominator } = measures[0].timeSignature;
  return {
    title: score.title,
    arranger: score.arranger,
    tonality: tonality.kind === "confirmed" ? `${tonality.tonality.tonic}${tonality.tonality.mode === "major" ? " 大调" : " 小调"}`
      : score.keySignature ? `1=${score.keySignature}` : "—",
    meter: `${numerator}/${denominator}`,
    measures: measures.length,
  };
}

export function displayName(entry: LibraryEntry) {
  return entry.displayName || entry.title.trim() || "未命名曲谱";
}
