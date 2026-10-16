import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  loadDocument,
  type ILXMDocument,
} from "@liuxianmao/lxm-editor";
import type { ScoreExampleRef } from "./model";

/** 将集中维护的 JSON 引用适配到现有编辑器文档，并复用正式 loader 校验。 */
export const resolveScoreExample = (
  reference: ScoreExampleRef,
): { ok: true; document: ILXMDocument } | { ok: false; error: string } => {
  if (
    reference.source !== "lxm-editor-example" ||
    reference.sourceDocument !== "mvp-7-2"
  )
    return { ok: false, error: "暂不支持该谱例来源" };
  // 从已校验的编辑器示例中选取八分节奏小节，避免教学页缩放整份长谱。
  const source = EXAMPLE_MVP_7_2_DOCUMENT;
  const track = source.score.tracks[0];
  const rhythmMeasure = track?.measures.find(
    (measure) => measure.sectionLabel === "八分节奏与高音",
  );
  if (!track || !rhythmMeasure)
    return { ok: false, error: "未找到八分音符教学谱例" };
  const teachingDocument: ILXMDocument = {
    ...source,
    score: {
      ...source.score,
      title: reference.title,
      tracks: source.score.tracks.map((item) =>
        item.id === track.id
          ? { ...item, measures: [structuredClone(rhythmMeasure)] }
          : { ...item, measures: [] },
      ),
    },
  };
  const result = loadDocument(JSON.stringify(teachingDocument));
  return result.ok
    ? { ok: true, document: result.document }
    : { ok: false, error: result.errors.join("；") };
};
