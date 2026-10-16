"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Exercise } from "../../lib/guitar-advanced/model";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import styles from "./PracticeQuestion.module.scss";

/** 单选练习的临时答案留在组件内，提交后的结果才进入持久化进度。 */
export const PracticeQuestion = ({ exercise }: { exercise: Exercise }) => {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const result = useGuitarAdvancedStore(
    (state) => state.progress.exerciseResults[exercise.id],
  );
  const submitExercise = useGuitarAdvancedStore(
    (state) => state.submitExercise,
  );
  const resetExerciseAttempt = useGuitarAdvancedStore(
    (state) => state.resetExerciseAttempt,
  );
  const setLastVisited = useGuitarAdvancedStore(
    (state) => state.setLastVisited,
  );

  useEffect(() => {
    setLastVisited({ kind: "exercise", id: exercise.id });
  }, [exercise.id, setLastVisited]);

  const submitted = Boolean(result);
  const answerSelected = result?.selectedOptionId ?? selectedOptionId;
  return (
    <div className={styles.page}>
      <Link
        className={styles.backLink}
        href={`/guitar-advanced/theory/${exercise.relatedLessonId}`}
      >
        <ArrowLeft aria-hidden="true" size={15} />
        返回理论
      </Link>
      <header className={styles.header}>
        <div>
          <span>节奏与拍点 / 练习 01</span>
          <h1>{exercise.title}</h1>
          <p>第 1 题 · 单选题</p>
        </div>
        <div className={styles.practiceProgress}>
          <span>本版本练习进度</span>
          <strong>{submitted ? "1 / 1" : "0 / 1"}</strong>
        </div>
      </header>

      <div className={styles.grid}>
        <section
          className={styles.questionCard}
          aria-labelledby="practice-question-title"
        >
          <h2 id="practice-question-title">{exercise.prompt}</h2>
          <div
            className={styles.options}
            role="radiogroup"
            aria-label="练习选项"
          >
            {exercise.options.map((option) => {
              const selected = answerSelected === option.id;
              const correct =
                submitted && option.id === exercise.answer.optionId;
              const wrong = submitted && selected && !correct;
              return (
                <label
                  className={styles.option}
                  data-selected={selected}
                  data-correct={correct}
                  data-wrong={wrong}
                  data-disabled={submitted}
                  key={option.id}
                >
                  <input
                    className={styles.radioInput}
                    type="radio"
                    name={exercise.id}
                    value={option.id}
                    checked={selected}
                    disabled={submitted}
                    onChange={() => setSelectedOptionId(option.id)}
                  />
                  <span className={styles.radioDot} aria-hidden="true" />
                  <span>{option.label}</span>
                  {correct ? (
                    <CheckCircle2 aria-label="正确答案" size={17} />
                  ) : null}
                </label>
              );
            })}
          </div>
          {submitted ? (
            <div
              className={styles.feedback}
              data-correct={result?.isCorrect}
              role="status"
            >
              {result?.isCorrect ? (
                <CheckCircle2 aria-hidden="true" size={18} />
              ) : (
                <CircleAlert aria-hidden="true" size={18} />
              )}
              <div>
                <strong>{result?.isCorrect ? "回答正确" : "还需要复习"}</strong>
                <p>
                  {result?.isCorrect
                    ? "你已经识别出一拍两次的八分音符节奏。"
                    : "正确答案是“每拍两次”，可以回到理论页复习时值关系。"}
                </p>
              </div>
            </div>
          ) : null}
          <div className={styles.actions}>
            {submitted ? (
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => {
                  resetExerciseAttempt(exercise.id);
                  setSelectedOptionId(null);
                }}
              >
                <RotateCcw aria-hidden="true" size={15} />
                重新练习
              </button>
            ) : (
              <button
                className={styles.primaryButton}
                type="button"
                disabled={!selectedOptionId}
                onClick={() => submitExercise(exercise.id, selectedOptionId)}
              >
                提交答案
              </button>
            )}
            <Link className={styles.secondaryButton} href="/guitar-advanced">
              返回学习路径
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </div>
        </section>

        <aside className={styles.explanation}>
          <span className={styles.eyebrow}>解析</span>
          <h2>为什么是“每拍两次”？</h2>
          <p>{exercise.explanation}</p>
          <Link
            className={styles.relatedLink}
            href={`/guitar-advanced/theory/${exercise.relatedLessonId}`}
          >
            <BookOpen aria-hidden="true" size={16} />
            回到理论小节复习
          </Link>
          <p className={styles.localHint}>
            练习答错后仍可继续学习，结果会保存在当前浏览器。
          </p>
        </aside>
      </div>
    </div>
  );
};
