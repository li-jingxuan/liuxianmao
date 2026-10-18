import { getAnswerIds, getCandidateIds, gradeExercise } from "./grading";
import type {
  GuitarAdvancedData,
  LastVisitedContent,
  LearningTarget,
} from "./model";
export const findModule = (data: GuitarAdvancedData, id: string) =>
  data.modules.find((item) => item.id === id) ?? null;
export const findLesson = (data: GuitarAdvancedData, id: string) =>
  data.lessons.find((item) => item.id === id) ?? null;
export const findExercise = (data: GuitarAdvancedData, id: string) =>
  data.exercises.find((item) => item.id === id) ?? null;
export const findTarget = (
  data: GuitarAdvancedData,
  target: LastVisitedContent,
): LearningTarget | null => {
  const item =
    target.kind === "lesson"
      ? findLesson(data, target.id)
      : findExercise(data, target.id);
  if (!item || findModule(data, item.moduleId)?.availability !== "available")
    return null;
  return {
    kind: target.kind,
    id: item.id,
    moduleId: item.moduleId,
    title: item.title,
    href: `/guitar-advanced/${target.kind === "lesson" ? "theory" : "practice"}/${item.id}`,
  };
};
/** 全站导航共用同一学习序列；共享练习只跟随主理论出现一次。 */
export const getLearningSequence = (
  data: GuitarAdvancedData,
): LearningTarget[] =>
  [...data.modules]
    .sort((a, b) => a.order - b.order)
    .filter((m) => m.availability === "available")
    .flatMap((m) =>
      [...data.lessons]
        .filter((l) => m.lessonIds.includes(l.id))
        .sort((a, b) => a.order - b.order)
        .flatMap((lesson) =>
          [
            findTarget(data, { kind: "lesson", id: lesson.id }),
            ...m.exerciseIds
              .map((id) => findExercise(data, id))
              .filter((e) => e?.lessonId === lesson.id)
              .map((e) =>
                e ? findTarget(data, { kind: "exercise", id: e.id }) : null,
              ),
          ].filter((t): t is LearningTarget => t !== null),
        ),
    );
export const getOrderedLessons = (data: GuitarAdvancedData) =>
  getLearningSequence(data)
    .filter((t) => t.kind === "lesson")
    .map((t) => findLesson(data, t.id)!);
const unique = (ids: readonly (string | number)[]) =>
  new Set(ids).size === ids.length;
/** 所有引用错误集中返回，内容测试可定位到具体实体。 */
export const validateGuitarAdvancedData = (
  data: GuitarAdvancedData,
): string[] => {
  const errors: string[] = [];
  const fail = (condition: boolean, message: string) => {
    if (!condition) errors.push(message);
  };
  fail(
    data.modules.length === 4 &&
      data.lessons.length === 8 &&
      data.exercises.length === 6,
    "发布数量应为 4 模块/8 理论/6 练习",
  );
  for (const [name, items] of Object.entries({
    modules: data.modules,
    lessons: data.lessons,
    exercises: data.exercises,
    scoreExamples: data.scoreExamples,
    diagrams: data.diagrams,
    stimuli: data.stimuli,
  }))
    fail(unique(items.map((x) => x.id)), `${name} ID 重复`);
  fail(unique(data.modules.map((m) => m.order)), "模块顺序重复");
  const lessons = getOrderedLessons(data);
  for (const m of data.modules) {
    fail(
      m.lessonIds.length === 2 && unique(m.lessonIds) && unique(m.exerciseIds),
      `${m.id}: 模块条目无效`,
    );
    fail(
      unique(
        data.lessons.filter((l) => l.moduleId === m.id).map((l) => l.order),
      ),
      `${m.id}: 理论顺序重复`,
    );
    for (const id of m.lessonIds)
      fail(
        findLesson(data, id)?.moduleId === m.id,
        `${m.id}: 理论 ${id} 归属无效`,
      );
    for (const id of m.exerciseIds)
      fail(
        findExercise(data, id)?.moduleId === m.id,
        `${m.id}: 练习 ${id} 归属无效`,
      );
  }
  for (const lesson of data.lessons) {
    const i = lessons.findIndex((l) => l.id === lesson.id);
    fail(
      data.modules.filter((m) => m.lessonIds.includes(lesson.id)).length === 1,
      `${lesson.id}: 模块收录无效`,
    );
    fail(
      lesson.previousLessonId === (lessons[i - 1]?.id ?? null) &&
        lesson.nextLessonId === (lessons[i + 1]?.id ?? null),
      `${lesson.id}: 前后理论不一致`,
    );
    const cards = lesson.blocks.filter(
      (b) => b.type === "paragraph" && b.title && b.content,
    ).length;
    fail(
      cards >= 3 &&
        cards <= 5 &&
        lesson.objectives.length > 0 &&
        lesson.blocks.some((b) => b.type === "callout") &&
        lesson.blocks.some(
          (b) => b.type === "diagram" || b.type === "scoreExample",
        ),
      `${lesson.id}: 理论内容不完整`,
    );
    fail(
      unique(lesson.exerciseIds) && lesson.exerciseIds.length > 0,
      `${lesson.id}: 关联练习无效`,
    );
    for (const id of lesson.exerciseIds) {
      const e = findExercise(data, id);
      fail(
        e?.moduleId === lesson.moduleId &&
          e.reviewLessonIds.includes(lesson.id),
        `${lesson.id}: 练习双向引用 ${id} 无效`,
      );
    }
    for (const b of lesson.blocks) {
      if (b.type === "scoreExample")
        fail(
          data.scoreExamples.some((s) => s.id === b.documentId),
          `${lesson.id}: 谱例不存在`,
        );
      if (b.type === "diagram")
        fail(
          data.diagrams.some((d) => d.id === b.diagramId),
          `${lesson.id}: 指板不存在`,
        );
    }
  }
  for (const e of data.exercises) {
    fail(
      data.modules.filter((m) => m.exerciseIds.includes(e.id)).length === 1,
      `${e.id}: 模块收录无效`,
    );
    fail(
      e.relatedLessonId === e.lessonId &&
        e.reviewLessonIds.includes(e.lessonId) &&
        unique(e.reviewLessonIds),
      `${e.id}: 主理论引用无效`,
    );
    for (const id of e.reviewLessonIds) {
      const l = findLesson(data, id);
      fail(
        l?.moduleId === e.moduleId && l.exerciseIds.includes(e.id),
        `${e.id}: 复习理论 ${id} 无效`,
      );
    }
    const graded = gradeExercise(e, e.answer, "validation");
    fail(
      graded.ok && graded.result.isCorrect && unique(getCandidateIds(e)),
      `${e.id}: 标准答案/候选无效`,
    );
    if (e.type === "ordering")
      fail(
        e.initialOrderIds.length === e.items.length &&
          unique(e.initialOrderIds) &&
          e.initialOrderIds.every((id) => e.items.some((x) => x.id === id)) &&
          e.initialOrderIds.some((id, i) => id !== e.answer.orderedIds[i]),
        `${e.id}: 初始排列无效`,
      );
    if (e.type === "targetSelection") {
      const d = data.diagrams.find((x) => x.id === e.diagramId);
      fail(
        Boolean(d) &&
          e.targetIds.every((id) => d?.positions.some((p) => p.id === id)),
        `${e.id}: 指板目标无效`,
      );
    }
    for (const id of [
      e.stimulusId,
      ...(e.type === "singleChoice" || e.type === "multipleChoice"
        ? e.options.map((o) => o.stimulusId)
        : []),
    ].filter((id): id is string => !!id))
      fail(
        data.stimuli.some((s) => s.id === id),
        `${e.id}: 题目素材 ${id} 不存在`,
      );
    fail(getAnswerIds(e.answer).length > 0, `${e.id}: 答案为空`);
  }
  for (const s of data.stimuli)
    fail(
      data.scoreExamples.some((x) => x.id === s.scoreExampleId),
      `${s.id}: 谱例引用无效`,
    );
  for (const s of data.scoreExamples)
    fail(s.documentId in data.teachingDocuments, `${s.id}: 文档不存在`);
  for (const d of data.diagrams)
    fail(
      unique(d.positions.map((p) => p.id)) &&
        d.positions.every(
          (p) =>
            d.stringNumbers.includes(p.stringNumber) &&
            p.fret >= d.fretRange.from &&
            p.fret <= d.fretRange.to,
        ),
      `${d.id}: 指板位置无效`,
    );
  fail(
    data.exercises.filter((e) => e.type === "singleChoice").length === 3 &&
      ["multipleChoice", "ordering", "targetSelection"].every(
        (type) => data.exercises.filter((e) => e.type === type).length === 1,
      ),
    "题型分布无效",
  );
  return errors;
};
