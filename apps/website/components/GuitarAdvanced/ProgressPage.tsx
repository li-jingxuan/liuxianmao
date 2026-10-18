"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Progress, Tag } from "antd";
import {
  getExamQuestionReviewItems,
  getExamHistory,
  getExerciseReviewItems,
  getProgressSummary,
  type ExamQuestionReviewItem,
  type ExerciseReviewItem,
} from "../../lib/guitar-advanced/results";
import type { GuitarAdvancedData, GuitarAdvancedExam } from "../../lib/guitar-advanced/model";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import styles from "./LearningUi.module.scss";

const ExerciseReviewCard = ({ item }: { item: ExerciseReviewItem }) => (
  <article className={styles.reviewCard}>
    <div className={styles.row}>
      <Tag color={item.reviewed ? "success" : "error"}>{item.reviewed ? "已复习" : "待复习"}</Tag>
      <span className={styles.muted}>{item.moduleTitle}</span>
    </div>
    <h3>{item.title}</h3>
    <p>{item.prompt}</p>
    {item.latestAnswerLabel && <p><strong>最近一次答案：</strong>{item.latestAnswerLabel}{item.latestWasCorrect ? "（正确）" : "（错误）"}</p>}
    {item.latestWasCorrect === true && <p className={styles.muted}>早期错误答案未单独保存；此处展示最近一次重做结果。</p>}
    <p>{item.explanation}</p>
    <div className={styles.actions}>
      {item.theoryTargets.map((target) => <Button key={target.id} href={target.href}>查看理论：{target.title}</Button>)}
      <Button type="primary" href={item.practiceTarget.href}>重新练习</Button>
    </div>
  </article>
);

const ExamReviewCard = ({
  item,
  onMarkReviewed,
  busy,
}: {
  item: ExamQuestionReviewItem;
  onMarkReviewed: (item: ExamQuestionReviewItem) => void;
  busy: boolean;
}) => (
  <article className={styles.reviewCard}>
    <div className={styles.row}>
      <Tag color={item.reviewed ? "success" : "error"}>{item.reviewed ? "已复习" : "待复习"}</Tag>
      <span className={styles.muted}>{item.moduleTitle} · 第 {item.order} 题</span>
    </div>
    <h3>{item.title}</h3>
    <p>{item.prompt}</p>
    <p><strong>你的答案：</strong>{item.userAnswerLabel}</p>
    <p><strong>正确答案：</strong>{item.correctAnswerLabel}</p>
    <Alert type="info" title="解析" description={item.explanation} />
    <div className={styles.actions}>
      {item.theoryTargets.map((target) => <Button key={target.id} href={target.href}>查看理论：{target.title}</Button>)}
      {item.exerciseTargets.map((target) => <Button key={target.id} href={target.href}>重新练习：{target.title}</Button>)}
      {!item.reviewed && <Button type="primary" loading={busy} onClick={() => onMarkReviewed(item)}>标记已复习</Button>}
    </div>
  </article>
);

export const ProgressPage = ({
  data,
  exam,
}: {
  data: GuitarAdvancedData;
  exam: GuitarAdvancedExam;
}) => {
  const progress = useGuitarAdvancedStore((state) => state.progress);
  const hydrated = useGuitarAdvancedStore((state) => state.hydrated);
  const issue = useGuitarAdvancedStore((state) => state.storageIssue);
  const retryPersist = useGuitarAdvancedStore((state) => state.retryPersist);
  const markReviewed = useGuitarAdvancedStore((state) => state.markExamQuestionReviewed);
  const activeId = progress.activeExamAttemptId;
  const active = activeId
    ? progress.examAttempts.find((attempt) => attempt.id === activeId && attempt.status === "draft")
    : null;
  const summary = getProgressSummary(data, progress, exam.id, [exam]);
  const examReviews = getExamQuestionReviewItems(data, progress, [exam]);
  const exerciseReviews = getExerciseReviewItems(data, progress);
  const examHistory = getExamHistory(progress.examAttempts, [exam]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (!hydrated)
    return <div className={styles.page}><Alert role="status" type="info" title="正在读取学习进度" /></div>;

  const handleMarkReviewed = (item: ExamQuestionReviewItem) => {
    setBusyKey(item.key);
    const result = markReviewed(item.attemptId, item.questionId);
    setBusyKey(null);
    setNotice(result.ok && result.persisted ? "已保存复习状态。" : "复习状态未保存，请检查顶部记录提示并重试。");
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><span className={styles.muted}>吉他进阶 · 当前浏览器</span><h1>学习进度</h1><p>查看已完成内容、考试成绩和需要复习的题目。</p></div>
        <Button href="/guitar-advanced">返回学习路径</Button>
      </header>
      {issue && <Alert role="alert" type="warning" title="学习记录提示" description={issue.message} action={issue.kind === "writeFailed" ? <Button size="small" onClick={() => { const result = retryPersist(); setNotice(result.ok && result.persisted ? "最新学习记录已保存。" : "保存仍未成功，请稍后重试。"); }}>重试保存</Button> : null} />}
      {notice && <Alert role="status" type="info" title={notice} />}

      <section className={`${styles.panel} ${styles.stack} ${styles.summary}`} aria-label="总体学习进度">
        <div className={styles.row}><h2>总体进度</h2><Tag color={summary.stage === "completed" ? "success" : summary.stage === "exam-ready" ? "processing" : "default"}>
          {summary.stage === "completed" ? "阶段已完成" : summary.stage === "exam-ready" ? "可以参加考试" : "学习中"}
        </Tag></div>
        <p>已完成 {summary.overall.completed} / {summary.overall.total} 项内容</p>
        <Progress percent={Math.round(summary.overall.ratio * 100)} />
        <div className={styles.metricGrid}>
          <div><span className={styles.muted}>理论小节</span><strong>{summary.completedLessonCount} / {summary.totalLessonCount}</strong></div>
          <div><span className={styles.muted}>练习题</span><strong>{summary.completedExerciseCount} / {summary.totalExerciseCount}</strong></div>
          <div><span className={styles.muted}>待复习</span><strong>{summary.pendingReviewCount}</strong></div>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.stack} ${styles.summary}`} aria-label="模块进度">
        <h2>模块进度</h2>
        <div className={styles.cards}>
          {summary.modules.map((module) => {
            const source = data.modules.find((item) => item.id === module.id)!;
            const lessonsDone = source.lessonIds.filter((id) => progress.completedLessonIds.includes(id)).length;
            const exercisesDone = source.exerciseIds.filter((id) => progress.completedExerciseIds.includes(id)).length;
            return <article className={styles.panel} key={module.id}>
              <div className={styles.row}><h3>{module.title}</h3><span>{module.completed} / {module.total}</span></div>
              <Progress percent={Math.round(module.ratio * 100)} />
              <p className={styles.muted}>理论 {lessonsDone}/{source.lessonIds.length} · 练习 {exercisesDone}/{source.exerciseIds.length}</p>
              <Button href={`/guitar-advanced/modules/${module.id}`}>查看模块</Button>
            </article>;
          })}
        </div>
      </section>

      <section className={`${styles.panel} ${styles.stack} ${styles.summary}`} aria-label="综合考试进度">
        <div className={styles.row}><h2>综合考试</h2><Tag color={summary.bestAttempt?.passed ? "success" : "default"}>{summary.bestAttempt?.passed ? "已通过" : summary.latestAttempt ? "继续提升" : "尚未参加"}</Tag></div>
        <div className={styles.metricGrid}>
          <div><span className={styles.muted}>最近成绩</span><strong>{summary.latestAttempt?.score ?? "—"} / {exam.maxScore}</strong></div>
          <div><span className={styles.muted}>最好成绩</span><strong>{summary.bestAttempt?.score ?? "—"} / {exam.maxScore}</strong></div>
          <div><span className={styles.muted}>考试次数</span><strong>{summary.submittedAttemptCount}</strong></div>
        </div>
        {active && <Alert type="info" title="有一份暂存答卷" description="继续上次考试会恢复原答题进度。" action={<Button type="primary" href={`/guitar-advanced/exam/attempt/${active.id}`}>继续考试</Button>} />}
        {!active && <Button type="primary" href="/guitar-advanced/exam">{summary.latestAttempt ? "再次考试" : summary.stage === "exam-ready" ? "开始考试" : "查看考试条件"}</Button>}
        {examHistory.length > 0 && <ul className={styles.list} aria-label="最近考试记录">
          {examHistory.slice(0, 5).map((item) => <li className={styles.row} key={item.attemptId}>
            <span>{new Date(item.submittedAt).toLocaleString("zh-CN")}</span><span>{item.score}/{item.maxScore} · {item.passed ? "通过" : "未通过"}</span><Link href={`/guitar-advanced/exam/result/${item.attemptId}`}>查看结果</Link>
          </li>)}
        </ul>}
      </section>

      <section className={`${styles.panel} ${styles.stack} ${styles.summary}`} aria-label="错题复习">
        <h2>错题复习</h2>
        <div className={styles.row}><h3>练习错题</h3><Tag color={exerciseReviews.length ? "error" : "success"}>{exerciseReviews.filter((item) => !item.reviewed).length} 题待复习</Tag></div>
        {exerciseReviews.length === 0 ? <Alert type="success" title="还没有练习错题" description="完成练习后，答错的题目会显示在这里。" /> : <div className={styles.reviewList}>{exerciseReviews.map((item) => <ExerciseReviewCard key={item.key} item={item} />)}</div>}
        <div className={styles.row}><h3>考试错题</h3><Tag color={examReviews.length ? "error" : "success"}>{examReviews.filter((item) => !item.reviewed).length} 题待复习</Tag></div>
        {summary.submittedAttemptCount === 0 ? <Alert type="info" title="尚无考试记录" description="完成全部理论与练习后参加综合考试，错题会汇总在这里。" /> : examReviews.length === 0 ? <Alert type="success" title="当前没有待复习的考试错题" description="后续考试答对的题目会从待复习列表移除，历史成绩仍会保留。" /> : <div className={styles.reviewList}>{examReviews.map((item) => <ExamReviewCard key={item.key} item={item} busy={busyKey === item.key} onMarkReviewed={handleMarkReviewed} />)}</div>}
      </section>
    </div>
  );
};
