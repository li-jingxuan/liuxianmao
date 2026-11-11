import { buildLayout, buildScoreScene } from "@liuxianmao/lxm-editor";
import { resolveScoreExample } from "../../lib/guitar-advanced/score-example-adapter";
import type {
  Exercise,
  GuitarAdvancedData,
  ScoreExampleRef,
} from "../../lib/guitar-advanced/model";
/**
 * 将课程谱例引用解析为文档，再生成只读布局和纯场景，不创建编辑会话或 React 元素。
 * 页面渲染与素材可用性检查共用结果，引用错误和布局异常都转换为可展示的失败值。
 */
export const prepareScore = (
  reference: ScoreExampleRef,
  documents: GuitarAdvancedData["teachingDocuments"],
) => {
  try {
    const resolved = resolveScoreExample(reference, documents);
    if (!resolved.ok)
      return { ok: false as const, error: resolved.errors.join("；") };
    const layout = buildLayout(resolved.document, {
      purpose: "presentation",
      systemWidth: 720,
      density: "compact",
      showChordDiagrams: false,
    });
    return { ok: true as const, layout, scene: buildScoreScene(layout) };
  } catch {
    return { ok: false as const, error: "谱例布局暂时无法生成" };
  }
};
export type PreparedScore = ReturnType<typeof prepareScore>;
/**
 * 汇总题干与选项谱例，并检查指板目标是否存在；ready 供调用方决定能否提交。
 * 保留各谱例的准备结果供 React 图层复用，避免校验和展示走两套布局流程。
 */
export const prepareExerciseMaterials = (
  exercise: Exercise,
  data: GuitarAdvancedData,
) => {
  const ids = [
    exercise.stimulusId,
    ...(exercise.type === "singleChoice" || exercise.type === "multipleChoice"
      ? exercise.options.map((o) => o.stimulusId)
      : []),
  ].filter((id): id is string => !!id);
  const errors: string[] = [];
  const scores: Record<
    string,
    { prepared: PreparedScore; reference: ScoreExampleRef; caption: string }
  > = {};
  for (const id of ids) {
    const stimulus = data.stimuli.find((s) => s.id === id),
      reference = data.scoreExamples.find(
        (s) => s.id === stimulus?.scoreExampleId,
      );
    if (!stimulus || !reference) {
      errors.push(`题目素材 ${id} 不存在`);
      continue;
    }
    const prepared = prepareScore(reference, data.teachingDocuments);
    scores[id] = { prepared, reference, caption: stimulus.caption };
    if (!prepared.ok) errors.push(prepared.error);
  }
  if (exercise.type === "targetSelection") {
    const diagram = data.diagrams.find((d) => d.id === exercise.diagramId);
    if (
      !diagram ||
      exercise.targetIds.some(
        (id) => !diagram.positions.some((p) => p.id === id),
      )
    )
      errors.push("指板素材或目标不存在");
  }
  return { scores, errors, ready: errors.length === 0 };
};
