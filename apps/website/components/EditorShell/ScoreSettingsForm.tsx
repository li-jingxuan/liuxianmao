"use client";

import { Alert, Button, Form, Input, InputNumber, Select } from "antd";
import {
  LXM_KEY_SIGNATURES,
  LXM_EDITABLE_TIME_SIGNATURES,
  type ILXMDocument,
  type ILXMKeySignature,
} from "@liuxianmao/lxm-editor";
import type { ScoreSettingsDraft, SettingsGroup, SettingsGroupStatus } from "./score-settings-draft";
import styles from "./index.module.scss";

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
    {inlineActions && <div className={styles.settingsActions}>
      <Button htmlType="submit" type="primary" block disabled={!groups[group].canApply}>{label}</Button>
      <Button block disabled={composing || busy || !groups[group].dirty} onClick={() => onRestore(group)}>恢复本组</Button>
    </div>}
  </>;
  return <div className={styles.settingsForms}>
    {issues.all && <Alert type="error" showIcon title={issues.all} />}
    <Form layout="vertical" data-settings-group="info" onFinish={() => onApply("info")} requiredMark={false}>
      <h3 tabIndex={-1}>歌曲信息</h3>
      <Form.Item label="歌曲名称" htmlFor="settings-title"><Input id="settings-title" aria-label="歌曲名称" value={value.title} disabled={busy} onChange={(event) => onChange("title", event.target.value)} /></Form.Item>
      <Form.Item label="编谱作者" htmlFor="settings-arranger"><Input id="settings-arranger" aria-label="编谱作者" value={value.arranger} disabled={busy} onChange={(event) => onChange("arranger", event.target.value)} /></Form.Item>
      <Form.Item label="调性" htmlFor="settings-key"><Select<ILXMKeySignature | ""> id="settings-key" aria-label="调性" value={value.keySignature ?? ""} disabled={busy} options={[{ value: "", label: "未设置" }, ...LXM_KEY_SIGNATURES.map((key) => ({ value: key, label: `1=${key}` }))]} onChange={(key) => onChange("keySignature", key || null)} /></Form.Item>
      <p className={styles.settingsHint}>调性仅更新歌曲信息，已有音符保持原音高。</p>
      {actions("info", "应用歌曲信息")}
    </Form>
    <Form layout="vertical" data-settings-group="signature" onFinish={() => onApply("signature")} requiredMark={false}>
      <h3 tabIndex={-1}>基础拍号</h3>
      <Form.Item label="基础拍号" htmlFor="settings-signature"><Select id="settings-signature" aria-label="基础拍号" disabled={busy} value={value.signature} options={signatureOptions} onChange={(signature) => onChange("signature", signature)} /></Form.Item>
      <p className={styles.settingsHint}>作用于第 1–{change < 0 ? track.measures.length : change} 小节；局部变化请在小节工具中操作。</p>
      {actions("signature", "应用基础拍号")}
    </Form>
    <Form layout="vertical" data-settings-group="capo" onFinish={() => onApply("capo")} requiredMark={false}>
      <h3 tabIndex={-1}>变调夹</h3>
      <Form.Item label="Capo" htmlFor="settings-capo" validateStatus={issues.capo ? "error" : undefined}><InputNumber<string> id="settings-capo" aria-label="Capo" stringMode min="0" max="12" step="1" changeOnBlur={false} disabled={busy} value={value.capo} onInput={(raw) => onChange("capo", raw)} onStep={(next) => onChange("capo", String(next))} style={{ width: "100%" }} /></Form.Item>
      <p className={styles.settingsHint}>0–12 的整数；0 表示不使用变调夹。</p>
      {actions("capo", "应用 Capo")}
    </Form>
    {onEditMeasure && <div>
      <p className={styles.settingsHint}>{measureIndex >= 0 ? `第 ${measureIndex + 1} 小节的段落标记、局部拍号与反复在「选区 → 小节」编辑。` : "段落标记、局部拍号与反复在「选区 → 小节」编辑。"}</p>
      <Button block onClick={onEditMeasure}>编辑当前小节{measureIndex >= 0 ? ` · 第 ${measureIndex + 1} 小节` : ""}</Button>
    </div>}
  </div>;
};
