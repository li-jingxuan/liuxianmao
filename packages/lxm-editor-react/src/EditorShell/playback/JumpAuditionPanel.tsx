import { Button, Checkbox } from "antd";
import { Fragment } from "react";
import { JUMP_MARK_LABEL, type PlaybackRepeatEndingIssue } from "@liuxianmao/lxm-editor";
import type { ScorePlaybackControls } from "./controller";
import styles from "./JumpAuditionPanel.module.scss";

export function JumpAuditionPanel({ playback, onRepair, onRepairRepeatEnding }: {
  playback: ScorePlaybackControls;
  onRepair: (markId: string) => void;
  onRepairRepeatEnding?: (issue: PlaybackRepeatEndingIssue) => void;
}) {
  const route = playback.jumpRoute;
  if (!route) return null;
  const { visits } = route;
  const current = visits.findIndex(({ visitIndex }) => visitIndex === playback.position?.visitIndex);
  const previous = visits[current - 1];
  const next = visits[current + 1];
  const at = visits[current];
  const issue = playback.jumpIssue ?? route.jumpIssue;
  const repeatIssue = playback.repeatEndingIssue ?? route.repeatEndingIssue;
  const repeatRepairMarkId = repeatIssue?.repairMarkId;
  const startSkipped = playback.startMeasureId && !visits.some(({ measureId }) => measureId === playback.startMeasureId);
  const loading = playback.phase === "loading";
  return (
    <aside className={styles.panel} data-jump-audition aria-label="跳转试听" onKeyDown={(event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing) playback.setEnabled(false);
    }}>
      <h2>跳转试听</h2>
      <p className={styles.position} aria-live="polite">
        {at ? `第 ${at.measureIndex + 1} 小节 · 到访 ${current + 1}/${visits.length}${at.repeatEnding ? ` · 反复第 ${at.repeatEnding.pass} 遍` : ""}` : `${visits.length} 次到访`}
      </p>
      {at?.jump && <p>{JUMP_MARK_LABEL[at.jump.kind]} · 进入第 {at.measureIndex + 1} 小节</p>}
      {startSkipped && <div className={styles.issue}>
        <p>演奏路线未到访当前起点，将从曲首试听。</p>
        <Button size="small" onClick={() => playback.setStartMeasure(null)}>从曲首</Button>
      </div>}
      {playback.jumpEnd && <p role="status" data-jump-playback-end={playback.jumpEnd.kind}>
        第 {playback.jumpEnd.measureIndex + 1} 小节 · {playback.jumpEnd.kind === "fine" ? "Fine · 重奏结束" : "曲尾 · 试听结束"}
      </p>}
      {issue && <div className={styles.issue} data-jump-playback-issue>
        <p>{`第 ${issue.measureIndex + 1} 小节${playback.jumpIssue ? "已暂停" : "弹完后暂停"}。${issue.message}。`}</p>
        <Button size="small" onClick={() => onRepair(issue.repairMarkId)}>返回编辑并定位</Button>
      </div>}
      {/* 房子缺遍次时用组身份修复，跳转记号仍沿用自己的身份和面板。 */}
      {repeatIssue && <div className={styles.issue} data-repeat-ending-playback-issue>
        <p>{`第 ${repeatIssue.measureIndex + 1} 小节${playback.repeatEndingIssue ? "已暂停" : "弹完后暂停"}。${repeatIssue.message}。`}</p>
        {repeatRepairMarkId && <Button size="small" onClick={() => onRepair(repeatRepairMarkId)}>返回编辑跳转记号</Button>}
        {!repeatRepairMarkId && onRepairRepeatEnding && <Button size="small" onClick={() => onRepairRepeatEnding(repeatIssue)}>返回编辑反复房子</Button>}
      </div>}
      <div className={styles.actions}>
        <Button size="small" disabled={!previous || loading} onClick={() => previous && playback.playVisits(previous.visitIndex)}>上一步</Button>
        <Button size="small" disabled={!next || loading} onClick={() => next && playback.playVisits(next.visitIndex)}>下一步</Button>
      </div>
      <div className={styles.options}>
        <Checkbox checked={playback.follow} onChange={({ target }) => target.checked ? playback.resumeFollow() : playback.suspendFollow()}>跟随谱面</Checkbox>
        <Checkbox checked={!playback.guitarMuted} onChange={({ target }) => playback.setGuitarMuted(!target.checked)}>木吉他声音</Checkbox>
      </div>
      <h3>到访顺序</h3>
      {/* 使用到访 ID 区分同一书写小节的多个实例，每项试听仍由实际音频时钟推进。 */}
      <ol className={styles.visits}>
        {visits.map((visit, index) => <li key={visit.visitIndex}>
          {index > 0 && <span aria-hidden="true" className={visit.jumped ? styles.jump : undefined}>{visit.jumped ? "↪" : "→"}</span>}
          <Button size="small" disabled={loading} data-jump-visit={visit.visitIndex}
            aria-current={index === current ? "step" : undefined} aria-label={`到访 ${index + 1}，第 ${visit.measureIndex + 1} 小节`}
            onClick={() => playback.playVisits(visit.visitIndex)}>{visit.measureIndex + 1}</Button>
        </li>)}
      </ol>
      {visits.some(({ jump }) => jump) && <Fragment>
        <h3>试听单次跳转</h3>
        <div className={styles.fragments}>
          {visits.map((visit, index) => {
            const from = visits[index - 1];
            if (!from || !visit.jump) return null;
            return <Button key={visit.visitIndex} disabled={loading} onClick={() => playback.playVisits(from.visitIndex, visit.visitIndex)}>
              {`${JUMP_MARK_LABEL[visit.jump.kind]} · ${from.measureIndex + 1} → ${visit.measureIndex + 1}`}
            </Button>;
          })}
        </div>
      </Fragment>}
    </aside>
  );
}
