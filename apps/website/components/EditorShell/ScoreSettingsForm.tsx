"use client";

import { Alert, Button, Form, Input, Select } from "antd";
import {
  LXM_KEY_SIGNATURES,
  LXM_EDITABLE_TIME_SIGNATURES,
  type ILXMDocument,
  type ILXMKeySignature,
  readScoreTonality,
  validateScoreTonality,
  SCORE_TONALITY_NAMESPACE,
  type ScoreTonalityV1,
} from "@liuxianmao/lxm-editor";
import { effectiveTonalityNamespace, type ScoreSettingsDraft, type SettingsGroup, type SettingsGroupStatus } from "./score-settings-draft";
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
  onChange, onApply, onRestore, onEditMeasure, measureId, infoConflict, onAcknowledgeInfo,
}: SettingsFormProps & { onEditMeasure?: () => void; measureId?: string; infoConflict?: { previous: unknown; current: unknown }; onAcknowledgeInfo?: () => void }) => {
  const track = document.score.tracks[0]!;
  const measureIndex = track.measures.findIndex((measure) => measure.id === measureId);
  const first = track.measures[0]!;
  const namespace = effectiveTonalityNamespace(value);
  const tonality = namespace.namespacePresent && !validateScoreTonality(namespace.namespaceRaw) ? namespace.namespaceRaw as ScoreTonalityV1 : null;
  // Keep invalid text visible while editing; it must not silently revert to the last valid spelling.
  const editing = value.tonalityIntent.kind === "set" ? value.tonalityIntent.value : tonality;
  const meta = { ...document.score.meta };
  if (namespace.namespacePresent) meta[SCORE_TONALITY_NAMESPACE] = namespace.namespaceRaw;
  else delete meta[SCORE_TONALITY_NAMESPACE];
  const tonalityState = readScoreTonality({ ...document, score: { ...document.score, keySignature: value.keySignature, meta } });
  const setTonality = (next: ScoreTonalityV1) => onChange("tonalityIntent", { kind: "set", value: next });
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
      <p role="status">设置预览：{tonalityState.title}</p>
      {"reason" in tonalityState && <Alert type="warning" title={tonalityState.reason} />}
      <Form.Item label="大小调" htmlFor="settings-mode"><Select<"" | "major" | "minor"> id="settings-mode" aria-label="大小调" value={editing?.mode ?? ""} disabled={busy} options={[{ value: "", label: "大小调未确认", disabled: true }, { value: "major", label: "大调" }, { value: "minor", label: "小调" }]} onChange={(mode) => { if (mode) setTonality(mode === "minor" ? { version: 1, tonic: editing?.tonic ?? value.keySignature ?? "C", mode, minorTonicDegree: editing?.mode === "minor" ? editing.minorTonicDegree : 6 } : { version: 1, tonic: editing?.tonic ?? value.keySignature ?? "C", mode }); }} /></Form.Item>
      <Form.Item label="主音拼写" htmlFor="settings-tonic"><Input id="settings-tonic" aria-label="主音拼写" placeholder="如 C、F#、Gb、Bbb" value={editing?.tonic ?? ""} disabled={busy || !editing} onChange={(event) => { if (editing) setTonality({ ...editing, tonic: event.target.value }); }} /></Form.Item>
      {editing?.mode === "minor" && <Form.Item label="小调主音记法" htmlFor="settings-minor-degree"><Select<1 | 6> id="settings-minor-degree" aria-label="小调主音记法" value={editing.minorTonicDegree} disabled={busy} options={[{ value: 6, label: "主音记作 6（建议）" }, { value: 1, label: "主音记作 1" }]} onChange={(minorTonicDegree) => setTonality({ ...editing, minorTonicDegree })} /></Form.Item>}
      <Form.Item label="数字 1 的音高" htmlFor="settings-key"><Select<ILXMKeySignature | ""> id="settings-key" aria-label="调性" value={value.keySignature ?? ""} disabled={busy || !!editing} options={[{ value: "", label: "未设置" }, ...LXM_KEY_SIGNATURES.map((key) => ({ value: key, label: `1=${key}` }))]} onChange={(key) => onChange("keySignature", key || null)} /></Form.Item>
      <div className={styles.inlineActions}>
        <Button size="small" disabled={busy || composing} onClick={() => onChange("tonalityIntent", { kind: "delete" })}>清除调性资料（保留 1={value.keySignature ?? "未设置"}）</Button>
        <Button size="small" disabled={busy || composing} onClick={() => { onChange("tonalityIntent", { kind: "delete" }); onChange("keySignature", null); }}>同时清除调性与数字 1</Button>
      </div>
      <p className={styles.hint}>应用前仅为设置预览，本调推荐仍以已应用曲谱为准。主音拼写会保留；此操作不转置音符、不改和弦名称或指法。指法与名称按当前指型记载，变调夹不自动改名或转调。</p>
      {infoConflict && <div role="region" aria-label="曲谱信息冲突核对">
        <p>请核对旧基线和最新已应用信息；保留整组输入后将重新验证调性关系。</p>
        <details><summary>查看新旧曲谱信息差异</summary><p>旧基线</p><pre>{JSON.stringify(infoConflict.previous, null, 2)}</pre><p>最新已应用信息</p><pre>{JSON.stringify(infoConflict.current, null, 2)}</pre></details>
        <Button disabled={busy || composing} onClick={() => onRestore("info")}>加载已应用信息</Button>
        <Button disabled={busy || composing} onClick={onAcknowledgeInfo}>核对并保留整组输入</Button>
      </div>}
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
