"use client";
import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Progress, Tag } from "antd";
import {
  getAttemptQuestionReviewItems,
  getBestExamAttempt,
  getExamHistory,
  getExamQuestionReviewItems,
  getLatestExamAttempt,
  getLowestScoringModules,
} from "../../lib/guitar-advanced/results";
import type { ExamAttempt, GuitarAdvancedData, GuitarAdvancedExam } from "../../lib/guitar-advanced/model";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import styles from "./LearningUi.module.scss";

type ResultNotice = { readonly tone: "success" | "error"; readonly text: string };
const formatDuration = (attempt: ExamAttempt): string => {
  if (!attempt.submittedAt) return "时长不可用";
  const elapsed = Date.parse(attempt.submittedAt) - Date.parse(attempt.startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "时长不可用";
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
};

export const ExamResultPage = ({
  attemptId,
  data,
  exams,
}: {
  attemptId: string;
  data: GuitarAdvancedData;
  exams: readonly GuitarAdvancedExam[];
}) => {
  const progress = useGuitarAdvancedStore((state) => state.progress);
  const hydrated = useGuitarAdvancedStore((state) => state.hydrated);
  const issue = useGuitarAdvancedStore((state) => state.storageIssue);
  const retryPersist = useGuitarAdvancedStore((state) => state.retryPersist);
  const markReviewed = useGuitarAdvancedStore((state) => state.markExamQuestionReviewed);
  const attempt = progress.examAttempts.find((item) => item.id === attemptId);
  const [notice, setNotice] = useState<ResultNotice | null>(null);
  const [busyQuestionId, setBusyQuestionId] = useState<string | null>(null);

  if (!hydrated)
    return <div className={styles.page}><Alert role="status" type="info" title="正在读取考试成绩" /></div>;
  if (!attempt)
    return <div className={styles.page}><Alert type="error" title="找不到这份考试记录" description="记录可能已被清除，或结果地址无效。" /></div>;
  if (attempt.status !== "submitted" || attempt.score === null || attempt.passed === null || !attempt.moduleScores)
    return <div className={styles.page}><Alert type="warning" title="这份答卷尚未提交" description="请返回考试页面继续答题，草稿不会显示为成绩。" action={<Button href={`/guitar-advanced/exam/attempt/${attempt.id}`}>继续考试</Button>} /></div>;

  const exam = exams.find((item) => item.id === attempt.examId);
  const maxScore = attempt.questionSnapshot.reduce((sum, question) => sum + question.points, 0);
  const sameExamAttempts = progress.examAttempts.filter((item) => item.examId === attempt.examId);
  const latest = getLatestExamAttempt(sameExamAttempts, attempt.examId);
  const best = getBestExamAttempt(sameExamAttempts, attempt.examId);
  const history = getExamHistory(sameExamAttempts, exams);
  const reviewItems = exam
    ? getAttemptQuestionReviewItems(data, attempt, exam, progress.examQuestionReviews)
    : [];
  const currentReviewItems = exam
    ? getExamQuestionReviewItems(data, progress, exams)
    : [];
  const lowestModules = !attempt.passed
    ? getLowestScoringModules(data.modules.map((module) => ({ id: module.id, score: attempt.moduleScores?.[module.id] ?? 0 })))
    : [];
  const reviewable = new Set(
    currentReviewItems
      .filter((item) => item.attemptId === attempt.id)
      .map((item) => item.questionId),
  );

  const markQuestionReviewed = (questionId: string) => {
    setBusyQuestionId(questionId);
    const result = markReviewed(attempt.id, questionId);
    setBusyQuestionId(null);
    setNotice(
      result.ok && result.persisted
        ? { tone: "success", text: "已标记为复习完成。" }
        : result.ok
          ? { tone: "error", text: "状态暂未保存，请在页面顶部重试保存。" }
          : { tone: "error", text: "这道题已不属于当前待复习状态，请刷新成绩后重试。" },
    );
  };

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/guitar-advanced/progress">← 返回学习进度</Link>
      {issue && <Alert role="alert" type="warning" title="本地记录提示" description={issue.message} action={issue.kind === "writeFailed" ? <Button size="small" onClick={() => { const result = retryPersist(); setNotice(result.ok && result.persisted ? { tone: "success", text: "成绩记录已保存。" } : { tone: "error", text: "保存仍未成功，请稍后重试。" }); }}>重试保存</Button> : null} />}
      {notice && <Alert role="status" type={notice.tone} title={notice.text} />}
      <header className={styles.header}>
        <div>
          <span className={styles.muted}>吉他进阶 · {exam?.title ?? "历史考试"}</span>
          <h1>综合考试结果</h1>
          <p>提交时间 {new Date(attempt.submittedAt!).toLocaleString("zh-CN")} · 用时 {formatDuration(attempt)}</p>
        </div>
        <Tag color={attempt.passed ? "success" : "error"}>{attempt.passed ? "已通过" : "未通过"}</Tag>
      </header>

      <div className={styles.examGrid}>
        <section className={`${styles.panel} ${styles.stack}`} aria-label="本次考试成绩">
          <div className={styles.scoreHero}>
            <strong>{attempt.score}</strong><span>/ {maxScore} 分</span>
          </div>
          <p>及格线 {attempt.passingScore} 分 · {attempt.passed ? "达到通过标准" : "尚未达到通过标准"}</p>
          <div className={styles.actions}>
            <Button type="primary" href="#exam-mistakes">复习错题</Button>
            <Button href="/guitar-advanced/exam">再次考试</Button>
            <Button href="/guitar-advanced/progress">学习进度</Button>
          </div>
        </section>
        <section className={`${styles.panel} ${styles.stack}`} aria-label="四模块得分">
          <h2>模块得分</h2>
          {data.modules.map((courseModule) => {
            const score = attempt.moduleScores?.[courseModule.id] ?? 0;
            return <div key={courseModule.id}>
              <div className={styles.row}><span>{courseModule.title}</span><strong>{score} / 25</strong></div>
              <Progress percent={Math.round((score / 25) * 100)} showInfo={false} />
            </div>;
          })}
        </section>
      </div>

      <section className={`${styles.panel} ${styles.stack} ${styles.summary}`} aria-label="成绩历史">
        <h2>成绩记录</h2>
        <div className={styles.metricGrid}>
          <div><span className={styles.muted}>最近一次</span><strong>{latest?.score ?? "—"} / {maxScore}</strong></div>
          <div><span className={styles.muted}>最好成绩</span><strong>{best?.score ?? "—"} / {maxScore}</strong></div>
          <div><span className={styles.muted}>考试次数</span><strong>{history.length}</strong></div>
        </div>
        {history.length > 1 && <ul className={styles.list} aria-label="历史考试">
          {history.slice(0, 5).map((item) => <li key={item.attemptId} className={styles.row}>
            <span>{new Date(item.submittedAt).toLocaleString("zh-CN")}</span>
            <span>{item.score} / {item.maxScore} · {item.passed ? "已通过" : "未通过"}</span>
            <Link href={`/guitar-advanced/exam/result/${item.attemptId}`}>查看</Link>
          </li>)}
        </ul>}
      </section>

      {lowestModules.length > 0 && <section className={`${styles.panel} ${styles.stack}`} aria-label="模块复习提示">
        <h2>优先复习模块</h2>
        <p className={styles.muted}>以下模块是本次得分最低项；分数相同时并列展示。</p>
        <div className={styles.actions}>{lowestModules.map((moduleId) => {
          const courseModule = data.modules.find((item) => item.id === moduleId);
          return courseModule ? <Button key={moduleId} href={`/guitar-advanced/modules/${moduleId}`}>{courseModule.title} · 查看模块</Button> : null;
        })}</div>
      </section>}

      <section id="exam-mistakes" className={`${styles.panel} ${styles.stack} ${styles.summary}`}>
        <div className={styles.row}><h2>本次需要复习的题目</h2><Tag>{reviewItems.length} 题</Tag></div>
        {!exam ? <Alert type="info" title="此考试版本暂不支持逐题复核" description="本次总分与模块成绩仍可查看，题目版本的复核规则未随当前应用提供。" /> : reviewItems.length === 0 ? <Alert type="success" title="本次考试没有待复习错题" /> : <div className={styles.reviewList}>
          {reviewItems.map((item) => {
            const isCurrentMistake = reviewable.has(item.questionId);
            return <article className={styles.reviewCard} key={item.key}>
              <div className={styles.row}>
                <Tag color={item.reviewed ? "success" : "error"}>{item.reviewed ? "已复习" : `第 ${item.order} 题`}</Tag>
                <span className={styles.muted}>{item.moduleTitle}</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.prompt}</p>
              <p><strong>你的答案：</strong>{item.userAnswerLabel}</p>
              <p><strong>正确答案：</strong>{item.correctAnswerLabel}</p>
              <Alert type="info" title="解析" description={item.explanation} />
              <div className={styles.actions}>
                {item.theoryTargets.map((target) => <Button key={target.id} href={target.href}>查看理论：{target.title}</Button>)}
                {item.exerciseTargets.map((target) => <Button key={target.id} href={target.href}>重新练习：{target.title}</Button>)}
                {!item.reviewed && <Button
                  type="primary"
                  disabled={!isCurrentMistake}
                  loading={busyQuestionId === item.questionId}
                  onClick={() => markQuestionReviewed(item.questionId)}
                >标记已复习</Button>}
                {!isCurrentMistake && <span className={styles.muted}>后续答卷已更新此题状态</span>}
              </div>
            </article>;
          })}
        </div>}
      </section>
    </div>
  );
};
