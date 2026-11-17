import { applyScoreCommand, LXMScoreCommandEnum, type ILXMDocument } from "@liuxianmao/lxm-editor";
import type { MeasureToolTarget } from "./editor-tool-actions";

/** 与 adapter 共用纯核心预检；这里只生成确认文字，不写文档。 */
export const previewMeasureRemoval = (document: ILXMDocument, target: MeasureToolTarget) => {
  const command = { type: LXMScoreCommandEnum.RemoveMeasure as const, ...target, expectedRevision: document.documentRevision };
  const initial = applyScoreCommand(document, command);
  const removedMarkIds = !initial.ok && initial.code === "NUMBERED_IMPACT_REQUIRED" ? initial.removedMarkIds ?? [] : [];
  const changedMarkIds = !initial.ok && initial.code === "NUMBERED_IMPACT_REQUIRED" ? initial.changedMarkIds ?? [] : [];
  const result = !initial.ok && initial.code === "NUMBERED_IMPACT_REQUIRED"
    ? applyScoreCommand(document, { ...command, confirmedRemovedMarkIds: removedMarkIds, confirmedChangedMarkIds: changedMarkIds }) : initial;
  if (!result.ok) return { ok: false as const, message: result.message };
  const effects = result.effects ?? [];
  const techniques = effects.filter((effect) => effect.kind === "technique.removed" || effect.kind === "technique.omitted");
  const marks = effects.filter((effect) => effect.kind === "numbered.mark.removed" || effect.kind === "numbered.mark.migrated" || effect.kind === "numbered.mark.omitted");
  const measureNumbers = [...new Set([...techniques, ...marks].map((effect) => effect.measureNumber))].sort((a, b) => a - b);
  return { ok: true as const, message: `另影响 ${techniques.length} 项技巧或跨小节关系、${Math.max(marks.length, new Set([...removedMarkIds, ...changedMarkIds]).size)} 项简谱连接记号${measureNumbers.length ? `（涉及第 ${measureNumbers.join("、")} 小节）` : ""}；删除、迁移或调整将一次提交。` };
};
