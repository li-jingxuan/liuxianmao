import { loadDocument } from "@liuxianmao/lxm-editor";
import type { GuitarAdvancedData, ScoreExampleRef } from "./model";
/** 素材来源显式注入；正式 loader 同时验证 schema、拍点和技巧关联。 */
export const resolveScoreExample = (
  reference: ScoreExampleRef,
  documents: GuitarAdvancedData["teachingDocuments"],
) => {
  const raw = documents[reference.documentId];
  if (!raw) return { ok: false as const, errors: ["未找到教学谱例文档"] };
  try {
    return loadDocument(JSON.stringify(raw));
  } catch {
    return { ok: false as const, errors: ["教学谱例无法解析"] };
  }
};
