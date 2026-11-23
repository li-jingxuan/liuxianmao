"use client";

import { Button, Checkbox, Form, Input, Select } from "antd";
import { CloseCircleOutlined } from "@ant-design/icons";
import { type ILXMDocument, MAX_SCORE_BPM, MIN_SCORE_BPM, readScoreTonality } from "@liuxianmao/lxm-editor";
import { ShortcutTooltip } from "../session/EditorShortcutReference";
import type { ScoreSettingsDraft, SettingsGroup, SettingsGroupStatus } from "./score-settings-draft";
import styles from "./ScoreSettingsForm.module.scss";

export interface SettingsCopyRange { start: string; end: string; after: string | null }
export type SettingsIssues = Partial<Record<SettingsGroup | "copy" | "all", string>>;
export interface SettingsFormProps {
  document: ILXMDocument;
  value: ScoreSettingsDraft;
  composing: boolean;
  busy?: boolean;
  issues: SettingsIssues;
  groups: Record<SettingsGroup, SettingsGroupStatus>;
  inlineActions?: boolean;
  onChange: <K extends keyof ScoreSettingsDraft>(key: K, value: ScoreSettingsDraft[K]) => void;
  onApply: (group: SettingsGroup) => void;
  onRestore: (group: SettingsGroup) => void;
}

/** 曲谱信息和演奏设置沿用同一草稿 owner，演奏三项共用一次提交。 */
export const ScoreSettingsForm = ({
  document, value, composing, busy, issues, groups,
  onChange, onApply, onRestore, infoConflict, onAcknowledgeInfo,
}: SettingsFormProps & { infoConflict?: { previous: unknown; current: unknown }; onAcknowledgeInfo?: () => void }) => {
  const track = document.score.tracks[0]!;
  const signature = track.measures[0]!.timeSignature;
  const tonality = readScoreTonality(document);
  const confirmed = tonality.kind === "confirmed" ? tonality.tonality : null;
  const error = (message?: string | null) => message ? <p className={styles.error} role="alert"><CloseCircleOutlined aria-hidden="true" /><span>{message}</span></p> : null;
  // 输入法和临时 busy 只禁用提交，不作为表单校验错误常驻展示。
  const groupError = (group: SettingsGroup) => error(issues[group] || (!busy && !composing ? groups[group].blockedReason : null));
  return <div className={styles.songForm}>
    {error(issues.all)}
    <Form className={styles.section} layout="vertical" data-settings-group="info" onFinish={() => onApply("info")} requiredMark={false}>
      <div className={styles.sectionHeading}><h3 tabIndex={-1}>曲谱信息</h3>
        <ShortcutTooltip shortcuts={["settings"]} disabled={!groups.info.canApply}>
          <Button className={styles.applyButton} type="primary" htmlType="submit" aria-label="应用曲谱信息" disabled={!groups.info.canApply}>应用</Button>
        </ShortcutTooltip>
      </div>
      <Form.Item label="歌曲名称" htmlFor="settings-title"><Input id="settings-title" aria-label="歌曲名称" value={value.title} disabled={busy} onChange={(event) => onChange("title", event.target.value)} /></Form.Item>
      <Form.Item label="编谱作者" htmlFor="settings-arranger"><Input id="settings-arranger" aria-label="编谱作者" value={value.arranger} disabled={busy} onChange={(event) => onChange("arranger", event.target.value)} /></Form.Item>
      <dl className={styles.readonlyFields} aria-label="曲谱调性（只读）">
        <div><dt>数字 1 的音高</dt><dd>{document.score.keySignature ? `1=${document.score.keySignature}` : "未设置"}</dd></div>
        <div><dt>调性</dt><dd>{confirmed ? `${confirmed.tonic}${confirmed.mode === "major" ? "大调" : "小调"}` : "调性未确认"}</dd></div>
        {confirmed && <div><dt>主音拼写</dt><dd>{confirmed.tonic}</dd></div>}
        <div><dt>基础拍号</dt><dd id="settings-signature">{signature.numerator}/{signature.denominator}</dd></div>
        {confirmed?.mode === "minor" && <div className={styles.minorNotation}><dt>小调主音记法</dt><dd>主音记作 {confirmed.minorTonicDegree}</dd></div>}
      </dl>
      {infoConflict && <div className={styles.conflict} role="region" aria-label="曲谱信息冲突核对">
        <p>歌曲名称或编谱作者已变化，请核对后继续。</p>
        <details><summary>查看新旧曲谱信息差异</summary><p>旧基线</p><pre>{JSON.stringify(infoConflict.previous, null, 2)}</pre><p>最新已应用信息</p><pre>{JSON.stringify(infoConflict.current, null, 2)}</pre></details>
        <Button size="small" disabled={busy || composing} onClick={() => onRestore("info")}>加载已应用信息</Button>
        <Button size="small" disabled={busy || composing} onClick={onAcknowledgeInfo}>核对并保留输入</Button>
      </div>}
      {groupError("info")}
    </Form>
    <section className={styles.section} aria-labelledby="settings-performance-heading">
      <div className={styles.sectionHeading}><h3 id="settings-performance-heading" tabIndex={-1}>演奏设置</h3></div>
      <Form layout="vertical" data-settings-group="capo" onFinish={() => onApply("capo")} requiredMark={false}>
        <div className={styles.performanceRow}><label htmlFor="settings-capo">变调夹</label><Select id="settings-capo" aria-label="变调夹" disabled={busy} value={value.capo} options={Array.from({ length: 13 }, (_, capo) => ({ value: String(capo), label: capo === 0 ? "不使用" : `${capo} 品` }))} onChange={(capo) => onChange("capo", capo)} /></div>
        <div className={styles.performanceRow}>
          <label htmlFor="settings-score-tempo">曲谱速度</label>
          <Input id="settings-score-tempo" inputMode="numeric" aria-describedby="settings-tempo-hint" suffix="BPM"
            disabled={busy} value={value.tempo} onChange={(event) => onChange("tempo", event.target.value)} />
        </div>
        <p id="settings-tempo-hint" className={styles.fieldNote}>输入 {MIN_SCORE_BPM}–{MAX_SCORE_BPM} 的整数。留空后应用可清空速度。</p>
        <Checkbox className={styles.tempoCheckbox} checked={value.showTempoMark} disabled={busy}
          onChange={(event) => onChange("showTempoMark", event.target.checked)}>展示曲谱速度</Checkbox>
        {groupError("capo")}
        <div className={styles.performanceActions}>
          <Button className={styles.applyButton} type="primary" htmlType="submit" aria-label="应用演奏设置" disabled={!groups.capo.canApply}>应用</Button>
        </div>
      </Form>
    </section>
  </div>;
};
