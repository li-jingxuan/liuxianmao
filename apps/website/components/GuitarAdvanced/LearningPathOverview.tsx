"use client";

import { ArrowRight, BookOpen, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import type {
  GuitarAdvancedData,
  GuitarModule,
} from "../../lib/guitar-advanced/model";
import {
  getContinueTarget,
  getModuleProgress,
  getOverallProgress,
} from "../../lib/guitar-advanced/progress";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import { ModuleCard } from "./ModuleCard";
import styles from "./LearningPathOverview.module.scss";

const toHref = (target: { kind: "lesson" | "exercise"; id: string } | null) => {
  if (!target) return null;
  return target.kind === "lesson"
    ? `/guitar-advanced/theory/${target.id}`
    : `/guitar-advanced/practice/${target.id}`;
};

const getModuleStatus = (
  module: GuitarModule,
  completed: number,
  total: number,
): "学习中" | "已完成" | "未开始" | "即将开放" => {
  if (module.availability === "comingSoon") return "即将开放";
  if (total > 0 && completed === total) return "已完成";
  if (completed > 0) return "学习中";
  return "未开始";
};

/** 学习总览把内容目录和运行时进度合并为页面所需的只读模型。 */
export const LearningPathOverview = ({
  data,
}: {
  data: GuitarAdvancedData;
}) => {
  const progress = useGuitarAdvancedStore((state) => state.progress);
  const clearProgress = useGuitarAdvancedStore((state) => state.clearProgress);
  const overall = useMemo(
    () => getOverallProgress(data.modules, progress),
    [data.modules, progress],
  );
  const continueTarget = useMemo(
    () =>
      getContinueTarget(data.modules, data.lessons, data.exercises, progress),
    [data.modules, data.lessons, data.exercises, progress],
  );
  const continueHref = toHref(continueTarget);
  const currentLesson = data.lessons.find(
    (lesson) => lesson.id === continueTarget?.id,
  );

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>吉他进阶</h1>
          <p>从读懂节奏，到能把知识用在一段真正的演奏里。</p>
        </div>
        {continueHref ? (
          <Link className={styles.heroButton} href={continueHref}>
            继续学习
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        ) : (
          <span className={styles.heroComplete}>本版本内容已完成</span>
        )}
      </header>

      <section
        className={styles.progressPanel}
        aria-labelledby="overall-progress-title"
      >
        <div>
          <span className={styles.eyebrow}>当前阶段 · 进阶基础</span>
          <h2 id="overall-progress-title">学习进度</h2>
          <p>
            已完成 {overall.completed} / {overall.total} 项内容
            {currentLesson ? ` · 下一步：${currentLesson.title}` : ""}
          </p>
        </div>
        <div className={styles.overallProgress}>
          <div className={styles.progressTrack}>
            <span style={{ width: `${overall.ratio * 100}%` }} />
          </div>
          <strong>{Math.round(overall.ratio * 100)}%</strong>
        </div>
      </section>

      <div className={styles.sectionHeading}>
        <div>
          <h2>学习路径</h2>
          <span>先完成开放模块，再逐步解锁后续内容</span>
        </div>
        <button
          className={styles.resetButton}
          type="button"
          onClick={() => {
            if (
              window.confirm("清除当前浏览器中的吉他进阶学习记录并重新开始？")
            )
              clearProgress();
          }}
        >
          <RotateCcw aria-hidden="true" size={14} />
          清除本地进度
        </button>
      </div>

      <section className={styles.pathGrid} aria-label="学习模块">
        {data.modules.map((module) => {
          const moduleProgress = getModuleProgress(module, progress);
          const status = getModuleStatus(
            module,
            moduleProgress.completed,
            moduleProgress.total,
          );
          const firstLesson = data.lessons.find(
            (lesson) => lesson.moduleId === module.id,
          );
          return (
            <ModuleCard
              key={module.id}
              module={module}
              completed={moduleProgress.completed}
              total={moduleProgress.total}
              status={status}
              targetHref={
                firstLesson ? `/guitar-advanced/theory/${firstLesson.id}` : null
              }
            />
          );
        })}
      </section>

      <aside className={styles.nextStep} aria-label="下一步学习">
        <div className={styles.nextStepIcon}>
          <BookOpen aria-hidden="true" size={20} />
        </div>
        <div>
          <span className={styles.eyebrow}>下一步</span>
          <h2>{currentLesson?.title ?? "完成本版本学习"}</h2>
          <p>
            {currentLesson
              ? "掌握基本时值关系，再进入对应练习。"
              : "你已经完成当前开放内容，可以等待下一阶段更新。"}
          </p>
        </div>
        {continueHref ? (
          <Link className={styles.nextStepButton} href={continueHref}>
            打开理论
          </Link>
        ) : null}
      </aside>
    </div>
  );
};
