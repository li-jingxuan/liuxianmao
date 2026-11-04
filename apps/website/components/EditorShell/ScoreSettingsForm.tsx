"use client";

import { Alert, Button, Form, Input, Select } from "antd";
import {
  LXM_KEY_SIGNATURES,
  LXM_EDITABLE_TIME_SIGNATURES,
  type ILXMDocument,
  type ILXMKeySignature,
} from "@liuxianmao/lxm-editor";
import type { ScoreSettingsDraft, SettingsGroup, SettingsGroupStatus } from "./score-settings-draft";
import styles from "./ScoreSettingsForm.module.scss";

export interface SettingsCopyRange { start: string; end: string; after: string }
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

/** 全曲表面只呈现受控的全曲字段。小节标记和复制由 MeasureSettingsForm 呈现。 */
export const ScoreSettingsForm = ({
  document, value, composing, busy, issues, groups, inlineActions = true,
  onChange, onApply, onRestore, onEditMeasure, measureId,
}: SettingsFormProps & { onEditMeasure?: () => void; measureId?: string }) => {
  const track = document.score.tracks[0]!;
  const measureIndex = track.measures.findIndex((measure) => measure.id === measureId);
  const first = track.measures[0]!;
  const change = track.measures.findIndex((measure, index) => index > 0 && (
    measure.timeSignature.numerator !== first.timeSignature.numerator ||
    measure.timeSignature.denominator !== first.timeSignature.denominator
  ));
  const signatureOptions: { value: string; label: string; disabled?: boolean }[] =
    LXM_EDITABLE_TIME_SIGNATURES.map((time) => ({ value: `${time.numerator}/${time.denominator}`, label: `${time.numerator}/${time.denominator}` }));
  if (!signatureOptions.some((option) => option.value === value.signature))
    signatureOptions.unshift({ value: value.signature, label: `${value.signature}（当前，只读）`, disabled: true });
  const actions = (group: SettingsGroup, label: string) => <>
    {(issues[group] || groups[group].blockedReason) && <Alert type="error" showIcon title={issues[group] || groups[group].blockedReason} />}
    <div className={styles.inlineActions}>
      <Button htmlType="submit" size="small" disabled={!groups[group].canApply}>{label}</Button>
      {inlineActions && <Button size="small" type="text" disabled={composing || busy || !groups[group].dirty} onClick={() => onRestore(group)}>恢复本组</Button>}
    </div>
  </>;
  return <div className={styles.songForm}>
    {issues.all && <Alert type="error" showIcon title={issues.all} />}
    <Form className={styles.section} layout="vertical" data-settings-group="info" onFinish={() => onApply("info")} requiredMark={false}>
      <div className={styles.sectionHeading}><h3 tabIndex={-1}>曲谱信息</h3><span>整首曲谱</span></div>
      <Form.Item label="歌曲名称" htmlFor="settings-title"><Input id="settings-title" aria-label="歌曲名称" value={value.title} disabled={busy} onChange={(event) => onChange("title", event.target.value)} /></Form.Item>
      <Form.Item label="编谱作者" htmlFor="settings-arranger"><Input id="settings-arranger" aria-label="编谱作者" value={value.arranger} disabled={busy} onChange={(event) => onChange("arranger", event.target.value)} /></Form.Item>
      <Form.Item label="调性" htmlFor="settings-key"><Select<ILXMKeySignature | ""> id="settings-key" aria-label="调性" value={value.keySignature ?? ""} disabled={busy} options={[{ value: "", label: "未设置" }, ...LXM_KEY_SIGNATURES.map((key) => ({ value: key, label: `1=${key}` }))]} onChange={(key) => onChange("keySignature", key || null)} /></Form.Item>
      <p className={styles.hint}>调性仅更新曲谱信息，已有音符保持原音高。</p>
      {actions("info", "应用曲谱信息")}
    </Form>
    <section className={styles.section} aria-labelledby="settings-performance-heading">
      <div className={styles.sectionHeading}><h3 id="settings-performance-heading" tabIndex={-1}>演奏设置</h3></div>
      <div className={styles.performanceFields}>
        <Form layout="vertical" data-settings-group="signature" onFinish={() => onApply("signature")} requiredMark={false}>
          <Form.Item label="基础拍号" htmlFor="settings-signature"><Select id="settings-signature" aria-label="基础拍号" aria-describedby="settings-performance-scope" disabled={busy} value={value.signature} options={signatureOptions} onChange={(signature) => onChange("signature", signature)} /></Form.Item>
          {actions("signature", "应用基础拍号")}
        </Form>
        <Form layout="vertical" data-settings-group="capo" onFinish={() => onApply("capo")} requiredMark={false}>
          <Form.Item label="变调夹" htmlFor="settings-capo" validateStatus={issues.capo ? "error" : undefined}><Select id="settings-capo" aria-label="Capo" aria-describedby="settings-performance-scope" disabled={busy} value={value.capo} options={Array.from({ length: 13 }, (_,capo) => ({ value: String(capo), label: capo === 0 ? "不使用" : `${capo} 品` }))} onChange={(capo) => onChange("capo", capo)} /></Form.Item>
          {actions("capo", "应用变调夹")}
        </Form>
        <p id="settings-performance-scope" className={styles.performanceHint}>基础拍号作用于谱首第 1–{change < 0 ? track.measures.length : change} 小节{change < 0 ? "（全曲）" : "，持续至下一个拍号变化点"}。变调夹作用于当前轨道全曲，谱面品位保持不变。</p>
      </div>
      <p className={styles.hint}>当前小节的段落、拍号和反复在「选区 → 小节」编辑。</p>
    </section>
    {onEditMeasure && <Button className={styles.measureLink} type="link" size="small" onClick={onEditMeasure}>编辑当前小节{measureIndex >= 0 ? ` · 第 ${measureIndex + 1} 小节` : ""}</Button>}
  </div>;
};
