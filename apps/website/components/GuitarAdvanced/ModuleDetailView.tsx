"use client";
import Link from "next/link";
import { Button, Tag } from "antd";
import type {
  GuitarAdvancedData,
  GuitarModule,
} from "../../lib/guitar-advanced/model";
import { getLearningSequence } from "../../lib/guitar-advanced/catalog";
import {
  getContinueTarget,
  isTargetComplete,
} from "../../lib/guitar-advanced/progress";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import styles from "./LearningUi.module.scss";
import { ExamProgressCard } from "./ExamProgressCard";
import type { GuitarAdvancedExam } from "../../lib/guitar-advanced/model";
export const ModuleDetailView = ({
  data,
  module,
  exam,
}: {
  data: GuitarAdvancedData;
  module: GuitarModule;
  exam: GuitarAdvancedExam;
}) => {
  const progress = useGuitarAdvancedStore((s) => s.progress);
  const next = getContinueTarget(data, progress, module.id),
    nodes = getLearningSequence(data).filter((t) => t.moduleId === module.id);
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/guitar-advanced">
        ← 返回学习路径
      </Link>
      <header className={styles.header}>
        <div>
          <h1>{module.title}</h1>
          <p>{module.summary}</p>
        </div>
        {next && (
          <Button type="primary" href={next.href}>
            继续{next.kind === "exercise" ? "练习" : "学习"}
          </Button>
        )}
      </header>
      <section className={styles.panel}>
        <h2>模块内容与复习清单</h2>
        <p className={styles.muted}>
          理论{" "}
          {
            module.lessonIds.filter((id) =>
              progress.completedLessonIds.includes(id),
            ).length
          }
          /{module.lessonIds.length} · 练习{" "}
          {
            module.exerciseIds.filter((id) =>
              progress.completedExerciseIds.includes(id),
            ).length
          }
          /{module.exerciseIds.length}
        </p>
        <ul className={styles.list}>
          {nodes.map((t) => (
            <li key={`${t.kind}-${t.id}`}>
              <div className={styles.row}>
                <Link href={t.href}>
                  {t.kind === "lesson" ? "理论" : "练习"} · {t.title}
                </Link>
                <div>
                  <Tag
                    color={
                      isTargetComplete(progress, t) ? "success" : "default"
                    }
                  >
                    {isTargetComplete(progress, t) ? "已完成" : "未完成"}
                  </Tag>
                  {t.kind === "exercise" &&
                    progress.wrongExerciseIds.includes(t.id) && (
                      <Tag
                        color={
                          progress.reviewedExerciseIds.includes(t.id)
                            ? "success"
                            : "warning"
                        }
                      >
                        {progress.reviewedExerciseIds.includes(t.id)
                          ? "已复习"
                          : "待复习"}
                      </Tag>
                    )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className={styles.muted}>
          考试入口根据所有模块的理论和练习完成情况解锁。
        </p>
      </section>
      <ExamProgressCard data={data} exam={exam} />
    </div>
  );
};
