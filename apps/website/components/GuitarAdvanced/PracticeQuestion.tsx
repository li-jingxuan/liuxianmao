"use client";
import Link from "next/link";
import { Alert, Button } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Exercise,
  GuitarAdvancedData,
} from "../../lib/guitar-advanced/model";
import {
  formatExerciseAnswer,
  gradeExercise,
} from "../../lib/guitar-advanced/grading";
import { getNextTarget } from "../../lib/guitar-advanced/progress";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import { prepareExerciseMaterials } from "./score-presentation";
import { PreparedScoreView } from "./GuitarScoreExample";
import {
  ExerciseAnswerInput,
  initialExerciseAnswer,
} from "./ExerciseAnswerInput";
import styles from "./LearningUi.module.scss";
/** 草稿仅在组件内；store 成功接受提交后才展示答案和解析。 */
export const PracticeQuestion = ({
  exercise,
  data,
}: {
  exercise: Exercise;
  data: GuitarAdvancedData;
}) => {
  const [draft, setDraft] = useState(() => initialExerciseAnswer(exercise));
  const [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const progress = useGuitarAdvancedStore((s) => s.progress),
    submit = useGuitarAdvancedStore((s) => s.submitExercise),
    reset = useGuitarAdvancedStore((s) => s.resetExerciseAttempt),
    visit = useGuitarAdvancedStore((s) => s.setLastVisited);
  useEffect(() => {
    visit({ kind: "exercise", id: exercise.id });
  }, [exercise.id, visit]);
  const materials = useMemo(() => {
    void retry;
    return prepareExerciseMaterials(exercise, data);
  }, [exercise, data, retry]);
  const result = progress.exerciseResults[exercise.id],
    answer = result?.answer ?? draft;
  const canSubmit =
    materials.ready && gradeExercise(exercise, draft, "validation").ok;
  const moduleItem = data.modules.find((m) => m.id === exercise.moduleId)!;
  const next = getNextTarget(data, progress, {
    kind: "exercise",
    id: exercise.id,
  });
  const stimulus = exercise.stimulusId
    ? materials.scores[exercise.stimulusId]
    : null;
  return (
    <div className={styles.page}>
      <Link
        className={styles.back}
        href={`/guitar-advanced/modules/${moduleItem.id}`}
      >
        ← {moduleItem.title}
      </Link>
      <header className={styles.header}>
        <div>
          <span className={styles.muted}>
            练习 {data.exercises.findIndex((e) => e.id === exercise.id) + 1}/6 ·{" "}
            {moduleItem.title}
          </span>
          <h1>{exercise.title}</h1>
          <p>提交后保存结果；未提交的答案刷新后会重置。</p>
        </div>
        <span>已完成 {progress.completedExerciseIds.length}/6 个练习</span>
      </header>
      <div className={styles.grid}>
        <section
          className={styles.panel}
          aria-labelledby="practice-question-title"
        >
          <h2 id="practice-question-title" ref={heading} tabIndex={-1}>
            {exercise.prompt}
          </h2>
          {!materials.ready && (
            <Alert
              type="error"
              title="题目素材加载失败，暂不能提交"
              description={materials.errors.join("；")}
              action={
                <Button onClick={() => setRetry((v) => v + 1)}>重试素材</Button>
              }
            />
          )}
          {stimulus && (
            <PreparedScoreView
              prepared={stimulus.prepared}
              title={stimulus.reference.title}
              caption={stimulus.caption}
            />
          )}
          <ExerciseAnswerInput
            exercise={exercise}
            data={data}
            answer={answer}
            disabled={!!result}
            onChange={setDraft}
            materials={materials}
          />
          {error && <Alert type="error" title={error} />}
          {result && (
            <div role="status" aria-live="polite" style={{ marginTop: 20 }}>
              <Alert
                showIcon
                type={result.isCorrect ? "success" : "warning"}
                title={result.isCorrect ? "回答正确" : "回答有误，仍可继续学习"}
                description={
                  <>
                    <p>
                      你的答案：{formatExerciseAnswer(exercise, result.answer)}
                    </p>
                    <p>
                      正确答案：
                      {formatExerciseAnswer(exercise, exercise.answer)}
                    </p>
                  </>
                }
              />
            </div>
          )}
          <div className={styles.actions}>
            {result ? (
              <Button
                onClick={() => {
                  const action = reset(exercise.id);
                  if (action.ok) {
                    setDraft(initialExerciseAnswer(exercise));
                    setError(null);
                    heading.current?.focus();
                  }
                }}
              >
                重新练习
              </Button>
            ) : (
              <Button
                type="primary"
                disabled={!canSubmit}
                onClick={() => {
                  const action = submit(exercise.id, draft);
                  setError(
                    action.ok
                      ? null
                      : action.reason === "alreadySubmitted"
                        ? "当前题已提交，请先重新练习。"
                        : "答案无效，请重新选择。",
                  );
                }}
              >
                提交答案
              </Button>
            )}
            {result && (
              <Button type="primary" href={next?.href ?? "/guitar-advanced"}>
                {next ? `下一步：${next.title}` : "返回学习路径"}
              </Button>
            )}
            <Button href={`/guitar-advanced/modules/${moduleItem.id}`}>
              返回模块
            </Button>
          </div>
        </section>
        <aside className={`${styles.panel} ${styles.sticky}`}>
          <h2>{result ? "答案解析" : "作答说明"}</h2>
          <p>
            {result
              ? exercise.explanation
              : "按题干要求完成选择或排序，提交后查看正确答案与解析。答错也会记录完成，可以重做复习。"}
          </p>
          <h3>相关理论</h3>
          <ul className={styles.list}>
            {exercise.reviewLessonIds.map((id) => (
              <li key={id}>
                <Link href={`/guitar-advanced/theory/${id}`}>
                  {data.lessons.find((l) => l.id === id)?.title}
                </Link>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>记录仅保存在当前浏览器。</p>
        </aside>
      </div>
    </div>
  );
};
