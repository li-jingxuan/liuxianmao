"use client";
import Link from "next/link";
import { Alert, Button, Tag } from "antd";
import { useEffect } from "react";
import type {
  GuitarAdvancedData,
  Lesson,
} from "../../lib/guitar-advanced/model";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import { GuitarScoreExample } from "./GuitarScoreExample";
import { FretboardDiagram } from "./FretboardDiagram";
import styles from "./LearningUi.module.scss";
/** 页面注入完整目录；理论展示不读取数据文件，不操作曲谱编辑状态。 */
export const TheoryLessonView = ({
  lesson,
  data,
}: {
  lesson: Lesson;
  data: GuitarAdvancedData;
}) => {
  const completed = useGuitarAdvancedStore((s) =>
    s.progress.completedLessonIds.includes(lesson.id),
  );
  const markComplete = useGuitarAdvancedStore((s) => s.markLessonComplete),
    visit = useGuitarAdvancedStore((s) => s.setLastVisited);
  useEffect(() => {
    visit({ kind: "lesson", id: lesson.id });
  }, [lesson.id, visit]);
  const moduleItem = data.modules.find((m) => m.id === lesson.moduleId)!;
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
          <h1>{lesson.title}</h1>
          <p>
            理论 {lesson.order}/2 · 预计 {lesson.durationMinutes} 分钟 ·{" "}
            {moduleItem.title}
          </p>
        </div>
        {completed && <Tag color="success">已完成</Tag>}
      </header>
      <div className={styles.grid}>
        <article className={styles.panel}>
          <h2>本节目标</h2>
          <ul>
            {lesson.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          {lesson.blocks.map((block, i) => {
            if (block.type === "paragraph")
              return (
                <section key={i} className={styles.theoryBlock}>
                  <h3>{block.title}</h3>
                  <p>{block.content}</p>
                </section>
              );
            if (block.type === "callout")
              return (
                <Alert
                  key={i}
                  title={block.title}
                  description={block.content}
                  type={block.tone === "warning" ? "warning" : "info"}
                  showIcon
                />
              );
            if (block.type === "diagram") {
              const diagram = data.diagrams.find(
                (d) => d.id === block.diagramId,
              );
              return diagram ? (
                <figure key={i}>
                  <FretboardDiagram diagram={diagram} />
                  <figcaption>{block.caption}</figcaption>
                </figure>
              ) : (
                <Alert key={i} type="error" title="指板暂时无法加载" />
              );
            }
            const reference = data.scoreExamples.find(
              (r) => r.id === block.documentId,
            );
            return reference ? (
              <GuitarScoreExample
                key={i}
                reference={reference}
                documents={data.teachingDocuments}
                caption={block.caption}
              />
            ) : (
              <Alert key={i} type="error" title="谱例不存在" />
            );
          })}
          <div className={styles.actions}>
            <Button type="primary" onClick={() => markComplete(lesson.id)}>
              {completed ? "本节已完成" : "完成本节"}
            </Button>
            {lesson.exerciseIds.map((id) => (
              <Button key={id} href={`/guitar-advanced/practice/${id}`}>
                进入练习
              </Button>
            ))}
          </div>
        </article>
        <aside className={`${styles.panel} ${styles.sticky}`}>
          <h2>{completed ? "理论已完成" : "理论学习中"}</h2>
          <p className={styles.muted}>
            完成本节后可以随时复习，练习答错也能继续下一节。
          </p>
          <Button onClick={() => markComplete(lesson.id)}>
            {completed ? "已标记完成" : "标记本节完成"}
          </Button>
          <p className={styles.muted}>学习记录保存在当前浏览器。</p>
          <Link href={`/guitar-advanced/modules/${moduleItem.id}`}>
            查看模块内容
          </Link>
        </aside>
      </div>
      <nav className={styles.actions} aria-label="理论前后节">
        {lesson.previousLessonId && (
          <Button href={`/guitar-advanced/theory/${lesson.previousLessonId}`}>
            上一节：
            {data.lessons.find((l) => l.id === lesson.previousLessonId)?.title}
          </Button>
        )}
        {lesson.nextLessonId && (
          <Button href={`/guitar-advanced/theory/${lesson.nextLessonId}`}>
            下一节：
            {data.lessons.find((l) => l.id === lesson.nextLessonId)?.title}
          </Button>
        )}
        <Button href="/guitar-advanced">返回学习路径</Button>
      </nav>
    </div>
  );
};
