"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, Button, Progress, Tag } from "antd";
import { getExamReadiness, getLatestExamAttempt } from "../../lib/guitar-advanced/exam";
import type { GuitarAdvancedData, GuitarAdvancedExam } from "../../lib/guitar-advanced/model";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import styles from "./LearningUi.module.scss";

export const ExamLandingPage = ({
  data,
  exam,
}: {
  data: GuitarAdvancedData;
  exam: GuitarAdvancedExam;
}) => {
  const router = useRouter();
  const progress = useGuitarAdvancedStore((state) => state.progress);
  const hydrated = useGuitarAdvancedStore((state) => state.hydrated);
  const startExam = useGuitarAdvancedStore((state) => state.startExam);
  const retryPersist = useGuitarAdvancedStore((state) => state.retryPersist);
  const issue = useGuitarAdvancedStore((state) => state.storageIssue);
  const readiness = getExamReadiness(data, progress);
  const active = progress.examAttempts.find(
    (attempt) => attempt.id === progress.activeExamAttemptId && attempt.status === "draft",
  );
  const latest = getLatestExamAttempt(progress.examAttempts);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!hydrated) {
    return <div className={styles.page}><Alert role="status" type="info" title="正在读取本地学习记录" /></div>;
  }
  const begin = () => {
    setError(null);
    setStarting(true);
    const result = startExam();
    setStarting(false);
    if (!result.ok) {
      setError(result.reason === "notReady" ? "还有课程内容未完成。" : "暂时无法开始考试，请检查本地记录。 ");
      return;
    }
    if (!result.persisted) {
      setError("答卷暂未保存，已经留在当前页面；请先重试保存，再进入考试。 ");
      return;
    }
    router.push(`/guitar-advanced/exam/attempt/${result.attempt.id}`);
  };
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/guitar-advanced">← 返回学习路径</Link>
      <header className={styles.header}>
        <div>
          <span className={styles.muted}>R5 · 固定综合考试</span>
          <h1>{exam.title}</h1>
          <p>整合节奏、和弦、音阶与弹奏技巧。</p>
        </div>
        {active && <Button type="primary" loading={starting} onClick={begin}>继续考试</Button>}
      </header>
      {issue && <Alert role="alert" type="warning" title="学习记录提示" description={issue.message} action={issue.kind === "writeFailed" ? <Button size="small" onClick={() => { const result = retryPersist(); setError(result.ok && result.persisted ? "答卷已保存，现在可以继续考试。" : "保存仍未成功，请稍后重试。"); }}>重试保存</Button> : null} />}
      {error && <Alert role="alert" type="error" title={error} />}
      <div className={styles.grid}>
        <section className={`${styles.panel} ${styles.stack}`}>
          <h2>考试说明</h2>
          <p>共 12 题，四个模块各 3 题、各占 25 分。总分达到 80 分即通过。</p>
          <ul>
            <li>题目固定，不限时；离开页面前可以暂存，之后继续同一份答卷。</li>
            <li>答卷提交后锁定；未作答题目按 0 分计。</li>
            <li>这是保存在当前浏览器内的学习检查，不是认证或防作弊考试。</li>
          </ul>
          {!readiness.eligible && !active ? (
            <>
              <h3>考试尚未解锁</h3>
              <p>完成以下 {readiness.pendingTargets.length} 项理论和练习后即可开始：</p>
              <ul className={styles.list}>
                {readiness.pendingTargets.map((target) => (
                  <li key={`${target.kind}-${target.id}`}>
                    <Link href={target.href}>{target.kind === "lesson" ? "理论" : "练习"} · {target.title}</Link>
                    <span className={styles.muted}> · {data.modules.find((module) => module.id === target.moduleId)?.title}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Button type="primary" size="large" loading={starting} onClick={begin}>
              {active ? "继续上次考试" : latest ? "开始新的考试" : "开始考试"}
            </Button>
          )}
        </section>
        <aside className={`${styles.panel} ${styles.stack}`}>
          <h2>学习前置条件</h2>
          {data.modules.map((module) => {
            const lessonsDone = module.lessonIds.filter((id) => progress.completedLessonIds.includes(id)).length;
            const exercisesDone = module.exerciseIds.filter((id) => progress.completedExerciseIds.includes(id)).length;
            const total = module.lessonIds.length + module.exerciseIds.length;
            const completed = lessonsDone + exercisesDone;
            return (
              <div key={module.id}>
                <div className={styles.row}>
                  <strong>{module.title}</strong>
                  <Tag color={completed === total ? "success" : "default"}>{completed}/{total}</Tag>
                </div>
                <Progress size="small" percent={total ? Math.round((completed / total) * 100) : 0} />
                <p className={styles.muted}>理论 {lessonsDone}/{module.lessonIds.length} · 练习 {exercisesDone}/{module.exerciseIds.length}</p>
              </div>
            );
          })}
          {latest && (
            <p>最近成绩：{latest.score}/100 · {latest.passed ? "已通过" : "未通过"}</p>
          )}
        </aside>
      </div>
    </div>
  );
};
