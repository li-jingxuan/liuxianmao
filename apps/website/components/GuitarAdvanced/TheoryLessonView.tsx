"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import type { Lesson } from "../../lib/guitar-advanced/model";
import { GUITAR_ADVANCED_SCORE_EXAMPLES } from "../../data/guitar-advanced";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import { GuitarScoreExample } from "./GuitarScoreExample";
import styles from "./TheoryLessonView.module.scss";

/** 理论页只负责渲染数据块和触发 store 动作，内容本身不写在组件里。 */
export const TheoryLessonView = ({ lesson }: { lesson: Lesson }) => {
  const completed = useGuitarAdvancedStore((state) =>
    state.progress.completedLessonIds.includes(lesson.id),
  );
  const markLessonComplete = useGuitarAdvancedStore(
    (state) => state.markLessonComplete,
  );
  const setLastVisited = useGuitarAdvancedStore(
    (state) => state.setLastVisited,
  );

  useEffect(() => {
    setLastVisited({ kind: "lesson", id: lesson.id });
  }, [lesson.id, setLastVisited]);

  const exerciseId = lesson.exerciseIds[0];
  return (
    <div className={styles.page}>
      <Link className={styles.backLink} href="/guitar-advanced">
        <ArrowLeft aria-hidden="true" size={15} />
        节奏与拍点
      </Link>
      <header className={styles.lessonHeader}>
        <div>
          <h1>{lesson.title}</h1>
          <p>
            理论 {String(lesson.order).padStart(2, "0")} · 预计学习{" "}
            {lesson.durationMinutes} 分钟
          </p>
        </div>
        {completed ? (
          <span className={styles.completedBadge}>
            <CheckCircle2 aria-hidden="true" size={15} />
            已完成
          </span>
        ) : null}
      </header>

      <div className={styles.lessonGrid}>
        <article className={styles.lessonArticle}>
          <section className={styles.objectiveSection}>
            <h2>本节目标</h2>
            <ul>
              {lesson.objectives.map((objective) => (
                <li key={objective}>
                  <CheckCircle2 aria-hidden="true" size={15} />
                  <span>{objective}</span>
                </li>
              ))}
            </ul>
          </section>
          {lesson.blocks.map((block, index) => {
            if (block.type === "paragraph")
              return (
                <section
                  className={styles.contentBlock}
                  key={`${block.type}-${index}`}
                >
                  {block.title ? <h2>{block.title}</h2> : null}
                  <p>{block.content}</p>
                </section>
              );
            if (block.type === "callout")
              return (
                <aside
                  className={styles.callout}
                  data-tone={block.tone}
                  key={`${block.type}-${index}`}
                >
                  <AlertTriangle aria-hidden="true" size={17} />
                  <div>
                    <strong>{block.title}</strong>
                    <p>{block.content}</p>
                  </div>
                </aside>
              );
            const reference = GUITAR_ADVANCED_SCORE_EXAMPLES.find(
              (item) => item.id === block.documentId,
            );
            return reference ? (
              <GuitarScoreExample
                key={`${block.type}-${index}`}
                reference={reference}
              />
            ) : null;
          })}
        </article>

        <aside className={styles.lessonAside}>
          <span className={styles.eyebrow}>本节状态</span>
          <strong>{completed ? "理论已完成" : "理论学习中"}</strong>
          <p>完成后可以随时回来复习，不会影响练习记录。</p>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => markLessonComplete(lesson.id)}
          >
            <CheckCircle2 aria-hidden="true" size={16} />
            {completed ? "已标记完成" : "标记本节完成"}
          </button>
          {exerciseId ? (
            <Link
              className={styles.secondaryButton}
              href={`/guitar-advanced/practice/${exerciseId}`}
            >
              进入节奏练习
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          ) : null}
          <p className={styles.localHint}>学习记录保存在当前浏览器。</p>
        </aside>
      </div>

      <footer className={styles.lessonFooter}>
        <Link className={styles.secondaryButton} href="/guitar-advanced">
          返回学习路径
        </Link>
        {exerciseId ? (
          <Link
            className={styles.primaryButton}
            href={`/guitar-advanced/practice/${exerciseId}`}
          >
            进入练习
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        ) : null}
      </footer>
    </div>
  );
};
