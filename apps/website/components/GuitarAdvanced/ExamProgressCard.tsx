"use client";
import Link from "next/link";
import { Button, Tag } from "antd";
import { getExamReadiness, getLatestExamAttempt } from "../../lib/guitar-advanced/exam";
import type { GuitarAdvancedData, GuitarAdvancedExam } from "../../lib/guitar-advanced/model";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import styles from "./LearningUi.module.scss";

export const ExamProgressCard = ({ data, exam }: { data: GuitarAdvancedData; exam: GuitarAdvancedExam }) => {
  const progress = useGuitarAdvancedStore((state) => state.progress);
  const readiness = getExamReadiness(data, progress);
  const active = progress.examAttempts.find((attempt) => attempt.id === progress.activeExamAttemptId && attempt.status === "draft");
  const latest = getLatestExamAttempt(progress.examAttempts);
  const href = active ? `/guitar-advanced/exam/attempt/${active.id}` : "/guitar-advanced/exam";
  return (
    <section className={`${styles.panel} ${styles.examCard}`} aria-label="综合考试">
      <div className={styles.row}>
        <h2>综合考试</h2>
        <Tag color={active ? "processing" : readiness.eligible ? "blue" : "default"}>
          {active ? "答卷暂存中" : readiness.eligible ? "已解锁" : "未解锁"}
        </Tag>
      </div>
      <p>固定 12 题 · 满分 100 分 · 80 分及格 · 四模块各占 25 分</p>
      {latest && <p className={styles.muted}>最近一次：{latest.score} / 100 · {latest.passed ? "已通过" : "未通过"}</p>}
      {!readiness.eligible && !active && <p className={styles.muted}>完成全部理论与练习后开放，共有 {readiness.pendingTargets.length} 项待完成。</p>}
      <Button type={readiness.eligible || active ? "primary" : "default"} href={href}>
        {active ? "继续考试" : latest ? "查看考试与再考" : readiness.eligible ? "进入考试" : "查看解锁条件"}
      </Button>
      {!readiness.eligible && !active && (
        <ul className={styles.list}>
          {readiness.pendingTargets.slice(0, 3).map((target) => <li key={`${target.kind}-${target.id}`}><Link href={target.href}>{target.title}</Link></li>)}
          {readiness.pendingTargets.length > 3 && <li>以及其他 {readiness.pendingTargets.length - 3} 项待完成内容</li>}
        </ul>
      )}
      <span className={styles.muted}>{exam.title}</span>
    </section>
  );
};
