"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Modal, Progress, Tag } from "antd";
import { ExerciseAnswerInput } from "./ExerciseAnswerInput";
import { prepareExerciseMaterials } from "./score-presentation";
import type { GuitarAdvancedData, GuitarAdvancedExam } from "../../lib/guitar-advanced/model";
import { gradeExamAttempt } from "../../lib/guitar-advanced/exam";
import { useGuitarAdvancedStore } from "../../stores/guitar-advanced-store";
import styles from "./LearningUi.module.scss";

export const ExamAttemptPage = ({
  attemptId,
  data,
  exam,
}: {
  attemptId: string;
  data: GuitarAdvancedData;
  exam: GuitarAdvancedExam;
}) => {
  const router = useRouter();
  const progress = useGuitarAdvancedStore((state) => state.progress);
  const hydrated = useGuitarAdvancedStore((state) => state.hydrated);
  const setAnswer = useGuitarAdvancedStore((state) => state.setExamAnswer);
  const setIndex = useGuitarAdvancedStore((state) => state.setExamQuestionIndex);
  const submitExam = useGuitarAdvancedStore((state) => state.submitExam);
  const retryPersist = useGuitarAdvancedStore((state) => state.retryPersist);
  const issue = useGuitarAdvancedStore((state) => state.storageIssue);
  const attempt = progress.examAttempts.find((item) => item.id === attemptId);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const question = attempt?.questionSnapshot[attempt.currentQuestionIndex];
  // 答卷快照由 store 更新，直接派生素材可避免 React Compiler 误判可变依赖。
  const materials = question ? prepareExerciseMaterials(question, data) : null;
  if (!hydrated) {
    return <div className={styles.page}><Alert role="status" type="info" title="正在恢复考试答卷" /></div>;
  }
  if (!attempt) {
    return (
      <div className={styles.page}>
        <Link className={styles.back} href="/guitar-advanced/exam">← 返回考试</Link>
        <Alert type="error" title="找不到这份考试答卷" description="它可能已被清除，或考试地址无效。" />
      </div>
    );
  }
  const isSubmitted = attempt.status === "submitted";
  const answerCount = Object.keys(attempt.answers).length;
  const unansweredCount = attempt.questionSnapshot.length - answerCount;
  const calculated = gradeExamAttempt(attempt, exam);
  const activeQuestion = attempt.questionSnapshot[attempt.currentQuestionIndex];
  const explanation = data.modules.find((module) => module.id === activeQuestion?.moduleId)?.title;
  const changeAnswer = (answer: Parameters<typeof setAnswer>[2]) => {
    setError(null);
    setSaved(null);
    const result = setAnswer(attempt.id, activeQuestion.id, answer);
    if (!result.ok) setError("这个答案无法保存，请重新选择。 ");
    else if (!result.persisted) setSaved("答案保留在当前页面，但尚未写入本地存储；请重试保存后再退出。");
  };
  const goTo = (index: number) => {
    setError(null);
    const result = setIndex(attempt.id, index);
    if (!result.ok) setError("无法切换题目，请刷新后重试。 ");
    else if (!result.persisted) setSaved("题目位置暂未保存；请重试保存后再退出。");
  };
  const leaveExam = () => {
    const result = setIndex(attempt.id, attempt.currentQuestionIndex);
    if (!result.ok || !result.persisted) {
      setSaved("答卷暂未保存，仍留在考试页面；请点“重试保存”后再退出。 ");
      return;
    }
    router.push("/guitar-advanced/exam");
  };
  const finish = () => {
    setBusy(true);
    const result = submitExam(attempt.id);
    setBusy(false);
    if (!result.ok) {
      setError("提交失败，答卷仍保留；请检查本地记录后重试。 ");
      return;
    }
    if (!result.persisted) setSaved("成绩已在当前页面生成，但还没有写入本地存储；请在结果页重试保存。 ");
    setSubmitOpen(false);
    router.push(`/guitar-advanced/exam/result/${attempt.id}`);
  };
  if (isSubmitted) {
    if (!calculated.ok || attempt.score === null || attempt.moduleScores === null || attempt.passed === null) {
      return <div className={styles.page}><Alert type="error" title="考试结果无法校验" description="原始答卷已保留，请勿重复提交。" /></div>;
    }
    return (
      <div className={styles.page}>
        <Link className={styles.back} href="/guitar-advanced/exam">← 返回考试</Link>
        <header className={styles.header}>
          <div><span className={styles.muted}>{exam.title} · 已提交</span><h1>本次考试结果</h1></div>
          <Tag color={attempt.passed ? "success" : "error"}>{attempt.passed ? "已通过" : "未通过"}</Tag>
        </header>
        <section className={`${styles.panel} ${styles.stack}`}>
          <h2>总分：{attempt.score} / {exam.maxScore}</h2>
          <p>及格线 {exam.passingScore} 分 · 提交时间 {new Date(attempt.submittedAt!).toLocaleString("zh-CN")}</p>
          <div className={styles.cards}>
            {data.modules.map((module) => (
              <article className={styles.panel} key={module.id}>
                <h3>{module.title}</h3>
                <p>{attempt.moduleScores?.[module.id]} / 25</p>
              </article>
            ))}
          </div>
          {issue && <Alert role="alert" type="warning" title="成绩记录保存提示" description={issue.message} action={issue.kind === "writeFailed" ? <Button size="small" onClick={() => { const result = retryPersist(); setSaved(result.ok && result.persisted ? "成绩已保存。" : "保存仍未成功，请稍后重试。"); }}>重试保存</Button> : null} />}
          {saved && <Alert role="status" type="success" title={saved} />}
          <Alert type="info" title="本次答卷已锁定" description="考试记录保存在当前浏览器。完整错题复习和成绩历史将在学习进度页面提供。" />
          <div className={styles.actions}>
            <Button href="/guitar-advanced">返回学习路径</Button>
            <Button type="primary" href={`/guitar-advanced/exam/result/${attempt.id}`}>查看完整结果</Button>
            <Button type="primary" href="/guitar-advanced/exam">查看考试或再次考试</Button>
          </div>
        </section>
      </div>
    );
  }
  if (!question || !activeQuestion || !materials) {
    return <div className={styles.page}><Alert type="error" title="答卷题目数据无效" description="原始答卷已保留，当前无法继续或提交。" /></div>;
  }
  return (
    <div className={styles.page}>
      <Button className={styles.back} type="link" onClick={leaveExam}>← 考试入口</Button>
      <header className={styles.header}>
        <div>
          <span className={styles.muted}>进行中 · 满分 {exam.maxScore} · {exam.passingScore} 分及格</span>
          <h1>{exam.title}</h1>
        </div>
        <Button onClick={leaveExam}>暂存并退出</Button>
      </header>
      {issue && <Alert role="alert" type="warning" title="记录保存提示" description={issue.message} action={issue.kind === "writeFailed" ? <Button size="small" onClick={() => { const result = retryPersist(); setSaved(result.ok && result.persisted ? "答卷已保存。" : "保存仍未成功，请稍后重试。"); }}>重试保存</Button> : null} />}
      {saved && <Alert role="alert" type="warning" title={saved} />}
      {error && <Alert role="alert" type="error" title={error} />}
      <section className={`${styles.panel} ${styles.summary}`} aria-label="考试进度">
        <div className={styles.row}>
          <span>考试进度</span>
          <strong>{attempt.currentQuestionIndex + 1} / {attempt.questionSnapshot.length}</strong>
          <span>已答 {answerCount} 题 · 剩余 {unansweredCount} 题</span>
        </div>
        <Progress percent={Math.round((answerCount / attempt.questionSnapshot.length) * 100)} />
      </section>
      <div className={styles.examGrid}>
        <section className={`${styles.panel} ${styles.stack}`}>
          <div className={styles.row}>
            <span>第 {activeQuestion.order} 题 · {explanation}</span>
            <Tag color={attempt.answers[activeQuestion.id] ? "success" : "default"}>{attempt.answers[activeQuestion.id] ? "已答" : "未答"}</Tag>
          </div>
          <h2>{activeQuestion.title}</h2>
          <p>{activeQuestion.prompt}</p>
          {materials.ready ? (
            <ExerciseAnswerInput
              exercise={activeQuestion}
              data={data}
              answer={attempt.answers[activeQuestion.id] ?? null}
              disabled={false}
              onChange={changeAnswer}
              materials={materials}
            />
          ) : <Alert type="error" title="题目素材暂不可用" description={materials.errors.join("；")} />}
          <div className={styles.row}>
            <Button disabled={attempt.currentQuestionIndex === 0} onClick={() => goTo(attempt.currentQuestionIndex - 1)}>上一题</Button>
            <Button disabled={attempt.currentQuestionIndex === 11} type="primary" onClick={() => goTo(attempt.currentQuestionIndex + 1)}>下一题</Button>
          </div>
        </section>
        <aside className={`${styles.panel} ${styles.stack} ${styles.examNavigator}`}>
          <h2>题目导航</h2>
          <div className={styles.questionGrid} role="group" aria-label="考试题目导航">
            {attempt.questionSnapshot.map((item, index) => {
              const answered = Boolean(attempt.answers[item.id]);
              return (
                <Button
                  key={item.id}
                  aria-label={`第 ${index + 1} 题，${index === attempt.currentQuestionIndex ? "当前题" : answered ? "已答" : "未答"}`}
                  aria-current={index === attempt.currentQuestionIndex ? "step" : undefined}
                  type={index === attempt.currentQuestionIndex ? "primary" : answered ? "default" : "text"}
                  className={answered ? styles.answeredQuestion : styles.unansweredQuestion}
                  onClick={() => goTo(index)}
                >
                  {index + 1}
                </Button>
              );
            })}
          </div>
          <p className={styles.muted}>已答和未答状态同时使用文字标识。</p>
          <Button type="primary" size="large" disabled={!materials.ready} onClick={() => setSubmitOpen(true)}>检查答卷并提交</Button>
        </aside>
      </div>
      <Modal
        open={submitOpen}
        title="确认提交考试"
        okText={unansweredCount ? "仍按未答题提交" : "确认提交"}
        cancelText={unansweredCount ? "返回检查" : "继续检查"}
        confirmLoading={busy}
        onCancel={() => setSubmitOpen(false)}
        onOk={finish}
      >
        <p>{unansweredCount ? `还有 ${unansweredCount} 题未作答，未答题按 0 分计。` : "提交后本次答案将锁定，不能再修改。"}</p>
        <p>确认提交后，本次考试记录将保存在当前浏览器。</p>
      </Modal>
    </div>
  );
};
