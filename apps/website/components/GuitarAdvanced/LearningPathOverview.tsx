"use client";
import Link from "next/link";
import { Button, Progress, Tag } from "antd";
import type { GuitarAdvancedData } from "../../lib/guitar-advanced/model";
import {
  getContinueTarget,
  getModuleProgress,
  getOverallProgress,
} from "../../lib/guitar-advanced/progress";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import { ExamProgressCard } from "./ExamProgressCard";
import type { GuitarAdvancedExam } from "../../lib/guitar-advanced/model";
import styles from "./LearningUi.module.scss";
export const LearningPathOverview = ({
  data,
  exam,
}: {
  data: GuitarAdvancedData;
  exam: GuitarAdvancedExam;
}) => {
  const progress = useGuitarAdvancedStore((s) => s.progress);
  const overall = getOverallProgress(data.modules, progress),
    next = getContinueTarget(data, progress);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.muted}>进阶基础 · 当前浏览器保存</span>
          <h1>吉他进阶</h1>
          <p>读懂节奏，理解和弦，把音阶与技巧连接起来。</p>
        </div>
        {next && (
          <Button type="primary" href={next.href}>
            {next.kind === "exercise" ? "继续练习" : "继续学习"}
          </Button>
        )}
      </header>
      <section
        className={`${styles.panel} ${styles.summary}`}
        aria-label="总体学习进度"
      >
        <h2>学习进度</h2>
        <p>
          已完成 {overall.completed} / {overall.total} 项内容 · 理论{" "}
          {progress.completedLessonIds.length}/8 · 练习{" "}
          {progress.completedExerciseIds.length}/6
        </p>
        <Progress percent={Math.round(overall.ratio * 100)} />
        {next ? (
          <p>
            下一步：<Link href={next.href}>{next.title}</Link>
          </p>
        ) : (
          <p>
            理论与练习已完成，可以进入综合考试或从下面的模块重新复习。
          </p>
        )}
      </section>
      <ExamProgressCard data={data} exam={exam} />
      <h2 id="learning-modules">学习路径</h2>
      <p className={styles.muted}>四个模块均可自由进入，建议按顺序学习。</p>
      <section className={styles.cards} aria-label="学习模块">
        {[...data.modules]
          .sort((a, b) => a.order - b.order)
          .map((m) => {
            const p = getModuleProgress(m, progress);
            return (
              <article className={styles.panel} key={m.id}>
                <div className={styles.row}>
                  <Tag
                    color={
                      p.completed === p.total
                        ? "success"
                        : p.completed
                          ? "processing"
                          : "default"
                    }
                  >
                    {p.completed === p.total
                      ? "已完成"
                      : p.completed
                        ? "学习中"
                        : "未开始"}
                  </Tag>
                  <span className={styles.muted}>0{m.order}</span>
                </div>
                <h2 style={{ marginTop: 16 }}>{m.title}</h2>
                <p className={styles.muted}>{m.summary}</p>
                <p>
                  理论{" "}
                  {
                    m.lessonIds.filter((id) =>
                      progress.completedLessonIds.includes(id),
                    ).length
                  }
                  /{m.lessonIds.length} · 练习{" "}
                  {
                    m.exerciseIds.filter((id) =>
                      progress.completedExerciseIds.includes(id),
                    ).length
                  }
                  /{m.exerciseIds.length}
                </p>
                <Progress percent={Math.round(p.ratio * 100)} size="small" />
                <Button href={`/guitar-advanced/modules/${m.id}`}>
                  {p.completed === p.total ? "查看复习" : "查看模块"}
                </Button>
              </article>
            );
          })}
      </section>
    </div>
  );
};
